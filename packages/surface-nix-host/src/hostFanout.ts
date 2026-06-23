/**
 * Per-host surface fan-out — the N-host, consume-side companions to this
 * package's single-host primitives (`getHostSession`, `makeClientCursor`).
 *
 * Two shapes a *parent* server needs when it dials many remote agents and
 * re-serves their surfaces to one downstream client (a browser, a TUI):
 *
 *   - `pumpRemoteSurface(session, makeSink)` — the reconnect-mirror loop. Pins
 *     the session, then loops over each successive `AgentClient` the session
 *     produces (one per (re)spawn — stdio links don't recover mid-stream, so
 *     the only reliable recovery is to re-mirror on the *new* client) and runs
 *     ONE `mirrorRemoteSurface` against it, folding the agent's frames into the
 *     caller's sink until the link dies, then waits for the next spawn. The
 *     consume-side dual of an `implementSurface` re-serve shell.
 *
 *   - `buildHostRegistry({ buildEntry })` — the keyed `Map<host, {session,
 *     handler}>` a `?host=` upgrade dispatcher reads. Owns only the map + its
 *     lifecycle (add/remove/reconnect/recheckAll + per-host socket eviction);
 *     the app supplies `buildEntry` (how a host becomes a session + an oRPC
 *     handler) and an optional `persist` hook (the host set's on-disk store).
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
import type { AnyContractRouter } from "@orpc/contract";
import type { AgentClient, HostSession } from "./hostSession";
import { makeClientCursor } from "./waitForNextClient";

// ── pumpRemoteSurface — the reconnect-mirror loop ──────────────────────────

/** A holder for the live spawn's forwarding handle — the procedure stubs or the
 *  `AgentClient` itself. The mirror is re-issued per spawn (stdio doesn't recover
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

export interface PumpRemoteSurfaceOptions<
  S extends SurfaceSpec,
  C extends AnyContractRouter,
> {
  /** The surface to mirror — the same definition the remote agent serves and
   *  the parent re-serves. */
  source: Surface<S>;
  /** The long-lived host session whose successive clients are pumped. */
  session: HostSession<C>;
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
   *  `AgentClient` for the life of each spawn, cleared when the link dies, so a
   *  re-serve's stream source can forward `client.surface.<stream>(input)` on
   *  demand. Omit when every primitive is folded through the sink. */
  liveClient?: LiveSpawnHolder<AgentClient<C>>;
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

/**
 * Pin `session`, then loop: fetch the current `AgentClient`, mirror the WHOLE
 * agent surface into the caller's sink with one `mirrorRemoteSurface` call,
 * block on `mirror.done` until the link dies (stdio process death), then wait
 * for the session to provide a fresh client (post-reconnect) and repeat —
 * until the session is destroyed.
 *
 * `mirrorRemoteSurface` returns the non-thenable handle `{ procedures, done }`,
 * so the loop blocks on `.done` (a bare `await mirrorRemoteSurface(...)` would
 * await a non-thenable and resolve at once, busy-spinning the loop). The
 * `makeClientCursor` comparison on the *promise* (not the awaited client) is
 * what keeps the loop from busy-spinning while a link is down — see there.
 */
export async function pumpRemoteSurface<
  S extends SurfaceSpec,
  C extends AnyContractRouter,
>(opts: PumpRemoteSurfaceOptions<S, C>): Promise<void> {
  const log = opts.log ?? (() => {});
  const { session } = opts;
  log("pinning HostSession (parent-lifetime ref)…");
  // Pin once. Swallow the initial promise — the loop fetches a fresh (possibly
  // re-spawned) client below regardless of whether this first spawn succeeded.
  session.pin().catch(() => {
    /* failure surfaces via the session's state cell; the loop recovers */
  });
  const cursor = makeClientCursor(session);
  let seq = 0;
  while (!session.isDestroyed()) {
    let client: AgentClient<C>;
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
      client as SurfaceClientLike,
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
    }
    log(`pump: mirror ended for client #${seq} — awaiting next client`);
  }
  log("pump: session destroyed — exiting reconnect loop");
}

// ── buildHostRegistry — the keyed per-host fan-out ─────────────────────────

/** One host's entry: its session and the oRPC handler a `?host=` dispatcher
 *  upgrades a browser socket onto. `H` stays generic (the app's
 *  `RPCHandler<…>`) so this package needs no `@orpc/server/ws` dependency —
 *  the registry only stores and hands back the handler, never constructs it. */
export interface HostEntry<C extends AnyContractRouter, H> {
  session: HostSession<C>;
  handler: H;
}

/** The structural subset of a server-side WebSocket the registry closes on
 *  host removal — kept structural (the `@kolu/surface-app` `GateableSocket`
 *  stance) so this package needn't depend on `ws`. partysocket auto-reconnects
 *  a browser, so a removal only "sticks" if the parent closes the socket. */
export interface ClosableSocket {
  close(code: number, reason?: string): void;
}

export interface HostRegistryOptions<C extends AnyContractRouter, H> {
  /** Hosts seeded synchronously at construction. */
  initialHosts: readonly string[];
  /** Build one host's `{ session, handler }`. Owns session provisioning
   *  (`getHostSession`), the re-serve router, and the oRPC handler — all the
   *  surface-specific knowledge the registry deliberately doesn't hold. Sync
   *  (matching `getHostSession`, which defers the spawn into the session's own
   *  reconnect machinery): a host unreachable at boot surfaces as a per-host
   *  `failed` connection state, never a throw that takes the whole registry —
   *  and with it the parent's HTTP port — down. */
  buildEntry: (host: string) => HostEntry<C, H>;
  /** Persist the next host set, awaited BEFORE `add`/`remove` commit their
   *  in-memory + session/socket changes — so the write is transactional: a
   *  persist rejection aborts the mutation with memory, sessions, sockets, and
   *  disk all still consistent (the just-built session is torn down on a failed
   *  `add`; a failed `remove` leaves the host fully live). Receives the intended
   *  post-mutation host list, not the current one. Omit for a static host set
   *  (no persistence — pulam-web R4.8a). */
  persist?: (hosts: string[]) => Promise<void>;
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

/** A per-host session + handler registry — the single source of truth for
 *  "which hosts this parent knows about", with insertion order preserved
 *  (`Map` semantics) so a UI lists hosts in the order they were added. */
export interface HostRegistry<C extends AnyContractRouter, H> {
  has(host: string): boolean;
  /** The known hosts, in insertion order. */
  hosts(): string[];
  getHandler(host: string): H | undefined;
  getSession(host: string): HostSession<C> | undefined;
  /** Spawn a new host's entry and persist. Throws if the host already exists
   *  (a key collision, not a re-add). */
  add(host: string): Promise<void>;
  /** Close any open browser sockets for the host, destroy its session, and
   *  persist. No-op for an unknown host. */
  remove(host: string): Promise<void>;
  /** Re-arm a host whose session gave up (`connection === "failed"`). No-op if
   *  the host isn't registered. */
  reconnect(host: string): void;
  /** Force a fresh link probe on every host — the fleet-wide companion to a
   *  wake / network-change signal. A healthy host blips through one fast
   *  reconnect; idle sessions are skipped (see `HostSession.recheck`). */
  recheckAll(): void;
  registerConnection(host: string, ws: ClosableSocket): void;
  unregisterConnection(host: string, ws: ClosableSocket): void;
  /** Destroy every host's session (server shutdown). */
  destroyAll(): void;
}

export function buildHostRegistry<C extends AnyContractRouter, H>(
  opts: HostRegistryOptions<C, H>,
): HostRegistry<C, H> {
  const log = opts.log ?? (() => {});
  const entries = new Map<string, HostEntry<C, H>>();
  const socketsByHost = new Map<string, Set<ClosableSocket>>();

  // Reject a duplicate in the seed list BEFORE building any entry. `Map.set`
  // would otherwise silently collapse the second occurrence onto the first —
  // but `buildEntry` has ALREADY run for it (started a pump, pinned a session),
  // so a config typo (`PULAM_WEB_HOSTS=box,box`) would leak a second session's
  // background reconnect loop under an overwritten map slot. Fail loud at the
  // seam where the duplicate is introduced, before any side effect.
  const seen = new Set<string>();
  for (const host of opts.initialHosts) {
    if (seen.has(host)) {
      throw new Error(
        `duplicate host in initialHosts: ${JSON.stringify(host)} — each host must appear once`,
      );
    }
    seen.add(host);
  }
  // Seed every configured host synchronously — `buildEntry` doesn't await
  // (the per-host probe lives inside the session's spawn cycle), so seeding
  // can't reject, and an unreachable boot host surfaces as a per-host `failed`
  // state instead of taking the registry down.
  for (const host of opts.initialHosts)
    entries.set(host, opts.buildEntry(host));

  // Persist the GIVEN next-host list (not `entries.keys()`) so the on-disk
  // store can be written BEFORE the in-memory + session/socket lifecycle is
  // committed. That ordering is what makes `add`/`remove` transactional: a
  // persist rejection leaves memory, sockets, sessions, and disk all in the
  // pre-mutation state instead of a half-applied mix (the inconsistency F5
  // flagged). A no-`persist` registry (a static host set) skips straight to
  // the commit.
  const persistHosts = async (nextHosts: string[]): Promise<void> => {
    if (opts.persist) await opts.persist(nextHosts);
  };

  return {
    has: (host) => entries.has(host),
    hosts: () => [...entries.keys()],
    getHandler: (host) => entries.get(host)?.handler,
    getSession: (host) => entries.get(host)?.session,

    async add(host) {
      if (entries.has(host)) throw new Error("host already exists");
      // Build the entry up front (so a `buildEntry` throw aborts before any
      // commit), but persist the next host set BEFORE inserting it. If persist
      // rejects, tear the just-built session down and DON'T insert — the caller
      // sees the rejection with memory and disk both still excluding `host`.
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

    reconnect(host) {
      entries.get(host)?.session.reconnect();
    },

    recheckAll() {
      for (const entry of entries.values()) entry.session.recheck();
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
}
