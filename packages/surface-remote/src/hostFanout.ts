/**
 * Per-host surface fan-out — the N-host, consume-side companions to this
 * package's single-host primitives (`makeSession`, `makeClientCursor`).
 *
 * Two shapes a *parent* server needs when it dials many remote agents and
 * re-serves their surfaces to one downstream client (a browser, a TUI):
 *
 *   - `pumpRemoteSurface(session, makeSink)` — the reconnect-mirror loop. Pins
 *     the session, then loops over each successive client the session produces (one
 *     per (re)dial — stdio links don't recover mid-stream, so the only reliable
 *     recovery is to re-mirror on the *new* client) and runs ONE
 *     `mirrorRemoteSurface` against it, folding the agent's frames into the caller's
 *     sink until the link dies, then waits for the next dial. The consume-side dual
 *     of an `implementSurface` re-serve shell.
 *
 *   - `buildRemotePool({ buildEntry })` — the keyed `Map<host, {session,
 *     handler}>` a `?host=` upgrade dispatcher reads. Owns only the map + its
 *     lifecycle (add/remove + per-host socket eviction, plus the optional fleet
 *     verbs a `controls` supplies); the app supplies `buildEntry` (how a host
 *     becomes a session + an oRPC handler) and an optional `persist` hook.
 *
 * Both are lifted verbatim-in-shape from drishti's `bridgeAgentToParent` +
 * `hostRegistry.ts` — the two consumers (drishti's process monitor, pulam-web's
 * terminal awareness) differ only in *which* surface/sink and *how* a host
 * resolves its `.drv`, so the mechanism is shared and the surface-specific
 * knowledge stays in the app's `makeSink` / `buildEntry`.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import {
  mirrorRemoteSurface,
  type ProcedureForwarders,
  type SurfaceSink,
} from "@kolu/surface/mirror";
import type { SurfaceClientLike } from "@kolu/surface/project";
import type { ConnectionInfo } from "./connection";
import { pipeSessionStateToCell } from "./connectionPipe";
import type { DestroyableSession, Session } from "./session";
import { makeClientCursor } from "./waitForNextClient";

// ── pumpRemoteSurface — the reconnect-mirror loop ──────────────────────────

/** A holder for the live spawn's forwarding handle — the procedure stubs or the
 *  client itself. The mirror is re-issued per spawn (stdio doesn't recover
 *  mid-stream), so a parent that *forwards* to the remote reads the live handle
 *  from here: the pump sets `.current` on each connect and clears it the instant
 *  the link dies, so a call against a just-dropped link fails honestly rather
 *  than relaying into a dead client. One shape for both forwarding slots (the
 *  procedures and the live client) so a consumer plugs into the same receptacle
 *  for either.
 *
 *  `onChange` is an OPTIONAL observer the pump fires every time it (re)sets or
 *  clears `.current` — so a forwarder that must stay open across reconnects (a
 *  re-served INPUT-parameterized stream that has to *rebind* to each successive
 *  live client, not complete when the current one dies) can wake on the next
 *  spawn instead of polling. A holder that just reads `.current` on demand omits
 *  it. The pump only fires it; the holder owns the listener set (see
 *  {@link observableHolder}). */
export interface LiveSpawnHolder<T> {
  current: T | null;
  /** Fired by the pump after every `.current` (re)assignment, including the
   *  clear-to-`null` on link death. Optional — omit for read-on-demand holders. */
  onChange?: () => void;
}

/** A {@link LiveSpawnHolder} that NOTIFIES — `whenChanged()` resolves on the
 *  next `.current` mutation the pump makes, so a forwarder can `await` the next
 *  live client (or its clear) rather than poll. The pump mutates `.current` and
 *  calls `onChange`; the holder fans that out to everyone waiting. Use this (not
 *  a bare `{ current: null }`) when a re-served stream must rebind across remote
 *  respawns instead of completing when one spawn's link dies. */
export interface ObservableHolder<T> extends LiveSpawnHolder<T> {
  /** Resolve on the next `.current` change. One-shot: re-await for the one after. */
  whenChanged(signal?: AbortSignal): Promise<void>;
}

/** Build an {@link ObservableHolder}. The `onChange` the pump fires wakes every
 *  pending `whenChanged()` waiter exactly once; an aborted waiter rejects with
 *  the signal's reason and detaches, so a torn-down subscription never leaks a
 *  listener. */
export function observableHolder<T>(): ObservableHolder<T> {
  const waiters = new Set<() => void>();
  return {
    current: null,
    onChange() {
      for (const wake of [...waiters]) wake();
    },
    whenChanged(signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const wake = (): void => {
          waiters.delete(wake);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = (): void => {
          waiters.delete(wake);
          reject(signal?.reason);
        };
        waiters.add(wake);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export interface PumpRemoteSurfaceOptions<S extends SurfaceSpec> {
  /** The surface to mirror — the same definition the remote agent serves and
   *  the parent re-serves. */
  source: Surface<S>;
  /** The long-lived session whose successive clients are pumped. Typed to the
   *  loose {@link Session} receptacle — not a concrete class — so both an ssh
   *  `makeSession` and kolu-server's padi arms plug in through the type system (no
   *  cast). The client is forwarded structurally (`SurfaceClientLike`); a caller
   *  that wants the precise per-contract client reads it off its own typed session. */
  session: Session;
  /** Build the mirror sink for ONE freshly-spawned client. Called once per
   *  (re)spawn, so per-client state (first-frame flags, frame counters) resets
   *  naturally each reconnect. Wire `session.markConnected()` into whichever
   *  frame signals the link is live — the framework can't know which primitive
   *  leads a given surface's handshake. The live client/procedures reach
   *  forwarding code through the holders below, so the sink-builder takes only
   *  `seq` (which labels successive spawns `#1`, `#2`, … for tracing an
   *  otherwise-identical per-reconnect log line). */
  makeSink: (ctx: { seq: number }) => SurfaceSink<S>;
  /** Optional forwarding-stub holder for re-serving the mirror's procedures.
   *  Set to each spawn's `mirror.procedures` for the life of that spawn,
   *  cleared when the link dies. Omit for a read-only surface (no procedures
   *  to forward). */
  liveProcedures?: LiveSpawnHolder<ProcedureForwarders<S>>;
  /** Optional live-client holder for re-serving primitives the *sink* can't
   *  fold — chiefly INPUT-parameterized streams (a per-repo / per-file watcher
   *  the parent can't subscribe with one fixed input up front). Set to the live
   *  client for the life of each spawn, cleared when the link dies, so a re-serve's
   *  stream source can forward `client.surface.<stream>(input)` on demand. Omit
   *  when every primitive is folded through the sink. */
  liveClient?: LiveSpawnHolder<SurfaceClientLike>;
  /** Optional hook fired each time a spawn's mirror ENDS — the link died (stdio
   *  process death) or the session was destroyed — AFTER the live holders are
   *  cleared. The cue to drop any per-link LOCAL state the next spawn must
   *  rebuild from the fresh snapshot rather than inherit stale. A read-only mirror
   *  with no standing local fold omits it. */
  onLinkDown?: () => void;
  /** Carry the SESSION's link health onto a browser-facing `connection` cell —
   *  the default-on mirror-seam wiring (#1564). When set, the pump subscribes
   *  `session.onState` ONCE for the session's lifetime (via
   *  `pipeSessionStateToCell`) and writes each projected frame through `set`,
   *  tearing the subscription down when the pump loop exits (the session was
   *  destroyed). `set` is the framework-wrapped `ctx.cells.connection.set` of the
   *  re-served surface. Omit for a re-serve that carries no link-health cell. */
  connection?: { set: (info: ConnectionInfo) => void };
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

/**
 * Pin `session`, then loop: fetch the current client, mirror the WHOLE agent
 * surface into the caller's sink with one `mirrorRemoteSurface` call, block on
 * `mirror.done` until the link dies (stdio process death), then wait for the
 * session to provide a fresh client (post-reconnect) and repeat — until the
 * session is destroyed.
 *
 * `mirrorRemoteSurface` returns the non-thenable handle `{ procedures, done }`,
 * so the loop blocks on `.done`. The `makeClientCursor` comparison on the
 * *promise* (not the awaited client) is what keeps the loop from busy-spinning
 * while a link is down — see there.
 */
export async function pumpRemoteSurface<S extends SurfaceSpec>(
  opts: PumpRemoteSurfaceOptions<S>,
): Promise<void> {
  const log = opts.log ?? (() => {});
  const { session } = opts;
  log("pinning session (parent-lifetime ref)…");
  // Pin once. Swallow the initial promise — the loop fetches a fresh (possibly
  // re-spawned) client below regardless of whether this first spawn succeeded.
  session.pin().catch(() => {
    /* failure surfaces via the session's state cell; the loop recovers */
  });
  // Default-on link-health: subscribe the session ONCE for its lifetime (NOT
  // per-spawn — `onState` outlives any single client) and write each projected
  // frame onto the re-served `connection` cell; torn down in the `finally` when
  // the loop exits (session destroyed).
  const unsubConnection = opts.connection
    ? pipeSessionStateToCell(session, opts.connection.set)
    : undefined;
  try {
    const cursor = makeClientCursor(session);
    let seq = 0;
    while (!session.isDestroyed()) {
      let client: SurfaceClientLike;
      try {
        client = await cursor.next();
      } catch (err) {
        log(`pump: waiting for next client failed: ${(err as Error).message}`);
        break;
      }
      seq += 1;
      log(`agent client ready (client #${seq}); starting mirror`);
      const mirror = mirrorRemoteSurface(
        opts.source,
        client,
        opts.makeSink({ seq }),
        { log },
      );
      // Publish this spawn's forwarding stubs + live client; clear them the
      // instant the link dies so a forward in the gap fails honestly rather than
      // calling a dead client. `onChange` wakes any forwarder holding open across
      // reconnects (an observable holder's `whenChanged()` waiters) — both on the
      // set (rebind to this spawn) and the clear (the link just died).
      if (opts.liveProcedures) {
        opts.liveProcedures.current = mirror.procedures;
        opts.liveProcedures.onChange?.();
      }
      if (opts.liveClient) {
        opts.liveClient.current = client;
        opts.liveClient.onChange?.();
      }
      try {
        await mirror.done;
      } finally {
        if (opts.liveProcedures) {
          opts.liveProcedures.current = null;
          opts.liveProcedures.onChange?.();
        }
        if (opts.liveClient) {
          opts.liveClient.current = null;
          opts.liveClient.onChange?.();
        }
        // The link to this spawn is down: let the consumer drop any per-link local
        // state (e.g. a re-serve's awareness fold) so the NEXT spawn rebuilds from
        // the fresh snapshot instead of painting a stale row across the reconnect.
        opts.onLinkDown?.();
      }
      log(`pump: mirror ended for client #${seq} — awaiting next client`);
    }
  } finally {
    unsubConnection?.();
  }
  log("pump: session destroyed — exiting reconnect loop");
}

// ── buildRemotePool — the keyed per-host fan-out ─────────────────────────

/** One host's entry: its session and the oRPC handler a `?host=` dispatcher
 *  upgrades a browser socket onto. The session slot is the minimal
 *  {@link DestroyableSession} (S1) — the registry only ever `destroy()`s it; a
 *  richer type (`Session`) still fits, and the app's `S` is what `getSession`
 *  hands back. `H` stays generic (the app's `RPCHandler<…>`) so this package needs
 *  no `@orpc/server/ws` dependency. */
export interface RemoteEntry<S extends DestroyableSession, H> {
  session: S;
  handler: H;
}

/** The structural subset of a server-side WebSocket the registry closes on
 *  host removal — kept structural (the `@kolu/surface-app` `GateableSocket`
 *  stance) so this package needn't depend on `ws`. partysocket auto-reconnects
 *  a browser, so a removal only "sticks" if the parent closes the socket. */
export interface ClosableSocket {
  close(code: number, reason?: string): void;
}

/** The optional fleet-keeping verbs a registry gains ONLY when built with
 *  `controls` (S2). Declared here so the union return type carries them exactly
 *  when the app supplied the machinery to enact them — calling `reconnect(host)`
 *  on a registry built without `controls` is a COMPILE error, not a silent no-op. */
export interface PoolControls {
  /** Re-arm the named host's session (its `reconnect()`), via the supplied
   *  control. No-op if the host isn't registered. */
  reconnect(host: string): void;
  /** Force a fresh link probe on every host (their `recheck()`), via the supplied
   *  control — the fleet-wide companion to a wake / network-change signal. */
  recheckAll(): void;
}

export interface RemotePoolOptions<S extends DestroyableSession, H> {
  /** Hosts seeded synchronously at construction. */
  initialHosts: readonly string[];
  /** Build one host's `{ session, handler }`. Owns session provisioning
   *  (`makeSession`), the re-serve router, and the oRPC handler — all the
   *  surface-specific knowledge the registry deliberately doesn't hold. Sync
   *  (matching `makeSession`, which defers the dial into the session's own
   *  reconnect machinery): a host unreachable at boot surfaces as a per-host
   *  `failed` connection state, never a throw that takes the whole registry down. */
  buildEntry: (host: string) => RemoteEntry<S, H>;
  /** Persist the next host set, awaited BEFORE `add`/`remove` commit their
   *  in-memory + session/socket changes — so the write is transactional. Receives
   *  the intended post-mutation host list, not the current one. Omit for a static
   *  host set. */
  persist?: (hosts: string[]) => Promise<void>;
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

/** Options for a registry WITH fleet controls (S2). Supplying `controls` unlocks
 *  `reconnect(host)`/`recheckAll()` on the returned registry (typed via the
 *  overload); the controls are how the registry enacts them on each session `S`. */
export interface RemotePoolControlOptions<S extends DestroyableSession, H>
  extends RemotePoolOptions<S, H> {
  controls: {
    /** Re-arm one session (drishti: `(s) => s.reconnect()`). */
    reconnect: (session: S) => void;
    /** Force one session's link probe (drishti: `(s) => s.recheck()`). */
    recheck: (session: S) => void;
  };
}

/** A per-host session + handler registry — the single source of truth for
 *  "which hosts this parent knows about", with insertion order preserved
 *  (`Map` semantics) so a UI lists hosts in the order they were added. The fleet
 *  verbs (`reconnect`/`recheckAll`) are NOT here — they live on {@link PoolControls},
 *  present on the returned registry only when built with `controls` (S2). */
export interface RemotePool<S extends DestroyableSession, H> {
  /** Is this host registered? */
  has(host: string): boolean;
  /** The known hosts, in insertion order. */
  hosts(): string[];
  /** The host's oRPC handler (what a `?host=` upgrade dispatcher hands the
   *  browser socket), or `undefined` for an unknown host. */
  getHandler(host: string): H | undefined;
  /** The host's session (its connection lifecycle), or `undefined` if unknown. */
  getSession(host: string): S | undefined;
  /** Spawn a new host's entry and persist. Throws if the host already exists
   *  (a key collision, not a re-add). */
  add(host: string): Promise<void>;
  /** Close any open browser sockets for the host, destroy its session, and
   *  persist. No-op for an unknown host. */
  remove(host: string): Promise<void>;
  /** Track an open browser socket for `host`, so `remove(host)` can close it. */
  registerConnection(host: string, ws: ClosableSocket): void;
  /** Stop tracking a socket once it has closed on its own. */
  unregisterConnection(host: string, ws: ClosableSocket): void;
  /** Destroy every host's session (server shutdown). */
  destroyAll(): void;
}

// Overloads: supplying `controls` widens the RETURN type to carry the fleet verbs;
// omitting it returns the bare registry, where `reconnect`/`recheckAll` don't exist
// (calling them won't compile — no optional methods, no silent no-ops). This is S2's
// "illegal call fails to typecheck".
export function buildRemotePool<S extends DestroyableSession, H>(
  opts: RemotePoolControlOptions<S, H>,
): RemotePool<S, H> & PoolControls;
export function buildRemotePool<S extends DestroyableSession, H>(
  opts: RemotePoolOptions<S, H>,
): RemotePool<S, H>;
export function buildRemotePool<S extends DestroyableSession, H>(
  opts: RemotePoolOptions<S, H> & {
    controls?: {
      reconnect: (session: S) => void;
      recheck: (session: S) => void;
    };
  },
): RemotePool<S, H> & Partial<PoolControls> {
  const log = opts.log ?? (() => {});
  const entries = new Map<string, RemoteEntry<S, H>>();
  const socketsByHost = new Map<string, Set<ClosableSocket>>();

  // Reject a duplicate in the seed list BEFORE building any entry. `Map.set`
  // would otherwise silently collapse the second occurrence onto the first —
  // but `buildEntry` has ALREADY run for it (started a pump, pinned a session),
  // so a config typo would leak a second session's background reconnect loop
  // under an overwritten map slot. Fail loud at the seam, before any side effect.
  const seen = new Set<string>();
  for (const host of opts.initialHosts) {
    if (seen.has(host)) {
      throw new Error(
        `duplicate host in initialHosts: ${JSON.stringify(host)} — each host must appear once`,
      );
    }
    seen.add(host);
  }
  // Seed every configured host synchronously — `buildEntry` doesn't await, so
  // seeding can't reject, and an unreachable boot host surfaces as a per-host
  // `failed` state instead of taking the registry down.
  for (const host of opts.initialHosts)
    entries.set(host, opts.buildEntry(host));

  // Persist the GIVEN next-host list (not `entries.keys()`) so the on-disk store
  // can be written BEFORE the in-memory + session/socket lifecycle is committed —
  // the ordering that makes `add`/`remove` transactional. A no-`persist` registry
  // (a static host set) skips straight to the commit.
  const persistHosts = async (nextHosts: string[]): Promise<void> => {
    if (opts.persist) await opts.persist(nextHosts);
  };

  const registry: RemotePool<S, H> = {
    has: (host) => entries.has(host),
    hosts: () => [...entries.keys()],
    getHandler: (host) => entries.get(host)?.handler,
    getSession: (host) => entries.get(host)?.session,

    async add(host) {
      if (entries.has(host)) throw new Error("host already exists");
      // Build the entry up front (so a `buildEntry` throw aborts before any
      // commit), but persist the next host set BEFORE inserting it. If persist
      // rejects, tear the just-built session down and DON'T insert.
      const entry = opts.buildEntry(host);
      try {
        await persistHosts([...entries.keys(), host]);
      } catch (err) {
        entry.session.destroy();
        throw err;
      }
      entries.set(host, entry);
      log(`added host: ${host} (total ${entries.size})`);
    },

    async remove(host) {
      const entry = entries.get(host);
      if (entry === undefined) return;
      // Persist the post-removal set FIRST. If it rejects, the host stays fully
      // live (session intact, sockets open, still in `entries`) and matches the
      // disk that still lists it — no destroy-but-still-on-disk split.
      await persistHosts([...entries.keys()].filter((h) => h !== host));
      // Persisted: now commit the destructive teardown.
      const sockets = socketsByHost.get(host);
      if (sockets !== undefined) {
        for (const ws of sockets) {
          try {
            ws.close(1000, "host removed");
          } catch {
            /* best-effort — a socket already closing is fine */
          }
        }
        socketsByHost.delete(host);
      }
      entry.session.destroy();
      entries.delete(host);
      log(`removed host: ${host} (total ${entries.size})`);
    },

    registerConnection(host, ws) {
      let set = socketsByHost.get(host);
      if (set === undefined) {
        set = new Set();
        socketsByHost.set(host, set);
      }
      set.add(ws);
    },

    unregisterConnection(host, ws) {
      socketsByHost.get(host)?.delete(ws);
    },

    destroyAll() {
      for (const entry of entries.values()) entry.session.destroy();
      entries.clear();
      socketsByHost.clear();
    },
  };

  // Fleet controls (S2): present on the returned registry ONLY when the app
  // supplied `controls`. The verbs enact the app's control on each stored session.
  if (opts.controls === undefined) return registry;
  const controls = opts.controls;
  const fleet: PoolControls = {
    reconnect(host) {
      const entry = entries.get(host);
      if (entry !== undefined) controls.reconnect(entry.session);
    },
    recheckAll() {
      for (const entry of entries.values()) controls.recheck(entry.session);
    },
  };
  return { ...registry, ...fleet };
}
