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
 *     lifecycle (add / remove / retire + per-host socket eviction, plus the optional
 *     fleet verbs a `controls` supplies); the app supplies `buildEntry` (how a host
 *     becomes a session + a served handler) and an optional `persist` hook.
 *
 * Both are lifted verbatim-in-shape from drishti's `bridgeAgentToParent` +
 * `hostRegistry.ts` — the two consumers (drishti's process monitor, kolu-server's
 * remote-padi terminal awareness) differ only in *which* surface/sink and *how* a host
 * resolves its `.drv`, so the mechanism is shared and the surface-specific
 * knowledge stays in the app's `makeSink` / `buildEntry`.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { isDeadTransportError } from "@kolu/surface/errors";
import {
  type MirrorFault,
  mirrorRemoteSurface,
  type ProcedureForwarders,
  type SurfaceSink,
} from "@kolu/surface/mirror";
import type { SurfaceClientLike } from "@kolu/surface/project";
import { Effect } from "effect";
import {
  type DestroyableSession,
  type Session,
  surfaceLiveProbe,
} from "./session";
import type { SshProv } from "./sshConnector";
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

/** A {@link LiveSpawnHolder} that NOTIFIES — `changed` completes on the next
 *  `.current` mutation the pump makes, so a forwarder can await the next live
 *  client (or its clear) rather than poll. The pump mutates `.current` and calls
 *  `onChange`; the holder fans that out to everyone waiting. Use this (not a bare
 *  `{ current: null }`) when a re-served stream must rebind across remote respawns
 *  instead of completing when one spawn's link dies. */
export interface ObservableHolder<T> extends LiveSpawnHolder<T> {
  /** An EFFECT that completes on the next `.current` change. One-shot — re-run it
   *  for the one after.
   *
   *  Effect-shaped rather than the old `whenChanged(signal): Promise<void>`
   *  (PLAN D10): its one consumer is `relayStream`'s rebind wait, which is now a
   *  `Stream`, and cancellation there is fiber INTERRUPTION, not an `AbortSignal`.
   *  Interrupting the awaiting fiber runs the effect's own finalizer, which
   *  detaches the waiter — so a torn-down subscription still leaks no listener,
   *  with no signal to thread and none to forget. */
  readonly changed: Effect.Effect<void>;
}

/** Build an {@link ObservableHolder}. The `onChange` the pump fires wakes every
 *  pending `changed` waiter exactly once. */
export function observableHolder<T>(): ObservableHolder<T> {
  const waiters = new Set<() => void>();
  return {
    current: null,
    onChange() {
      for (const wake of [...waiters]) wake();
    },
    changed: Effect.callback<void>((resume) => {
      const wake = (): void => {
        waiters.delete(wake);
        resume(Effect.void);
      };
      waiters.add(wake);
      // Interruption finalizer — detaching here is what makes an interrupted
      // waiter leave nothing behind (the old `signal.removeEventListener` pair).
      return Effect.sync(() => {
        waiters.delete(wake);
      });
    }),
  };
}

export interface PumpRemoteSurfaceOptions<S extends SurfaceSpec> {
  /** The surface to mirror — the same definition the remote agent serves and
   *  the parent re-serves. */
  source: Surface<S>;
  /** The long-lived session whose successive clients are pumped. Typed to the
   *  loose {@link Session} receptacle — not a concrete class — so both an ssh
   *  `makeSession` and kolu-server's padi arms plug in through the type system (no
   *  cast). `Prov = SshProv` (the ssh connector's provisioning vocabulary — the only
   *  sessions whose health the ssh-specific `connection` cell mirrors) so an ssh
   *  session plugs in alongside a `never` endpoint (`never extends SshProv`). The client is forwarded structurally
   *  (`SurfaceClientLike`); a caller that wants the precise per-contract client reads
   *  it off its own typed session. */
  session: Session<SurfaceClientLike, SshProv>;
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
  /** Optional supervision signal. Aborting it STOPS the pump WITHOUT destroying
   *  the caller-owned session: the active spawn's mirror is aborted (its per-key
   *  pumps settle via `signal.reason` — the #1719 ownership doctrine), the
   *  reconnect wait wakes, and the loop exits so the returned `done` resolves.
   *  A re-serve's `close()` drives this; omit for a pump whose only stop is the
   *  session's own destruction. */
  signal?: AbortSignal;
  /** Diagnostic CHATTER sink (reconnects, link ends). Default no-op — filter it
   *  freely. Faults do not come through here: see {@link PumpRemoteSurfaceOptions.onFault}. */
  log?: (line: string) => void;
  /** FAULT sink, forwarded verbatim to the mirror. Wire it at ERROR level: a
   *  key-scoped fault is the ONLY notice that a key stopped being mirrored (it
   *  never reaches `done`), and a member-scoped one narrates the death this pump
   *  is about to report. See `MirrorFault` and the fiber audit in
   *  `@kolu/surface/mirror`. */
  onFault?: (fault: MirrorFault) => void;
}

/** The verdict on a link whose mirror just ended, raced against the wait for the
 *  next spawn — see {@link probeEndedLink}. `answers` is the ONE outcome that
 *  stops the pump; `silent` falls back to the ordinary next-spawn wait. */
type EndedLinkVerdict = "answers" | "silent";

/** Ask the far end whether the link whose mirror JUST ended is still there, over
 *  the framework-reserved `system.live` round-trip — the SAME probe the session's
 *  own liveness watchdog runs (`surfaceLiveProbe`), read by the SAME three-way
 *  rule it applies:
 *
 *   - RESOLVES, or rejects with anything that is not a dead transport → the far
 *     end ANSWERED. The link is live and its mirror is over, so no further frame
 *     can arrive on it and no fresh spawn is coming: `"answers"`.
 *   - rejects with a DEAD-TRANSPORT error → the ordinary link death; the session
 *     is already redialing, so the pump must keep waiting: `"silent"`.
 *   - a probe that THROWS SYNCHRONOUSLY made no round-trip at all (a miswired
 *     client) — no liveness signal either way, so `"silent"`.
 *   - a probe that NEVER settles is a silently half-open link, which is the
 *     session liveness watchdog's job (it force-cycles within one probe cycle),
 *     not this loop's — the promise simply never settles, so the next-spawn wait
 *     it races against wins when that recovery lands.
 *
 *  Asking the far end is what makes the verdict race-free: the session's own
 *  `phase` is NOT a usable substitute, because the RPC layer can fail every call
 *  on a dead link BEFORE the transport's `closed` reaches `handleClosed` (the race
 *  `dialAgentOnce` already names), leaving the session reading `connected` over a
 *  corpse for that window. */
async function probeEndedLink(
  client: SurfaceClientLike,
): Promise<EndedLinkVerdict> {
  let probe: Promise<void>;
  try {
    probe = surfaceLiveProbe(client)();
  } catch {
    return "silent";
  }
  try {
    await probe;
    return "answers";
  } catch (err) {
    return isDeadTransportError(err) ? "silent" : "answers";
  }
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
 *
 * A mirror USUALLY ends because the link died, and then the session's own
 * reconnect machinery produces the next spawn the loop rides. But a mirror can
 * also end with the link fully ALIVE — every subscription settled (a far end that
 * closed its streams; a source with nothing to hold open) — and then no spawn is
 * ever coming: the wait for the next client would park FOREVER with the live
 * holders cleared, a pump silently serving nothing. So each mirror end races the
 * next-spawn wait against {@link probeEndedLink}: an answering corpse-of-a-mirror
 * ends the pump loudly instead.
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
  // SR9: the pump no longer carries link health onto a `connection` cell — that cell is
  // gone, and link health rides the host-map entry's fine `connection` payload (produced
  // by `serveHostMap` from the pool's `session.onState`, the ONE authority). The pump's
  // sole job is mirroring the agent's data surface. (SR9 removed the per-session
  // connection subscription that used to need an outer try/finally teardown here.)
  const cursor = makeClientCursor(session);
  let seq = 0;
  /** The client whose mirror ended on the PREVIOUS iteration, or `null` before the
   *  first mirror. Only a mirror END can leave the loop waiting on a spawn that
   *  will never come, so the liveness verdict is raced ONLY from the second wait
   *  onward — the FIRST wait legitimately parks for as long as the opening dial
   *  takes (an ssh provisioning campaign runs for minutes). */
  let endedClient: SurfaceClientLike | null = null;
  while (!session.isDestroyed() && !opts.signal?.aborted) {
    /** Did THIS lap's mirror fail (rather than end cleanly)? Set in the mirror's
     *  catch below, read at the bottom of the lap to skip the ended-on-a-live-link
     *  probe race, which only makes sense for a CLEAN end. */
    let failed = false;
    let client: SurfaceClientLike;
    try {
      const next = cursor.next(opts.signal);
      if (endedClient === null) client = await next;
      else {
        const outcome = await Promise.race([
          next.then((c) => ({ spawn: c })),
          probeEndedLink(endedClient).then((v) => ({ verdict: v })),
        ]);
        if ("spawn" in outcome) client = outcome.spawn;
        else if (outcome.verdict === "silent") client = await next;
        else {
          // The far end answered a link whose mirror is over: nothing more can
          // arrive on it, and the session has no reason to redial. Abandon the
          // next-spawn wait (swallowing its later rejection — nobody is left to
          // read it) and stop, rather than park forever serving nothing.
          next.catch(() => {});
          log(
            `pump: mirror ended for client #${seq} but the link still answers — ` +
              "no further frames can arrive; exiting reconnect loop",
          );
          return;
        }
      }
    } catch (err) {
      // A supervision `close()` aborts `opts.signal` while the pump is WAITING
      // for a fresh client (the link is down, no spawn coming) — `cursor.next`
      // then rejects with the signal's reason. That is a clean, requested stop,
      // NOT a failure: log it as such and exit quietly.
      if (opts.signal?.aborted) {
        log("pump: supervision stop while waiting for next client — exiting");
        break;
      }
      log(`pump: waiting for next client failed: ${(err as Error).message}`);
      break;
    }
    seq += 1;
    log(`agent client ready (client #${seq}); starting mirror`);
    // Thread the supervision signal into the mirror: on `close()`'s abort the
    // active spawn's per-key pumps reject their pulls with `signal.reason`
    // (swallowed) and settle, so `mirror.done` resolves and the loop's guard
    // above exits — composing WITH #1719's per-key ownership, not around it.
    const mirror = mirrorRemoteSurface(
      opts.source,
      client,
      opts.makeSink({ seq }),
      { onFault: opts.onFault, signal: opts.signal },
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
    } catch (err) {
      // A REJECTING mirror is a DEAD mirror (juspay/kolu#2101 G5) — a member's
      // upstream stream faulted, so that member is no longer being mirrored and
      // the whole mirror has unwound. That is a LINK DEATH, which is precisely
      // what this reconnect loop is for: the next spawn re-mirrors every member
      // from a fresh snapshot, which is also the repair. So it is caught here and
      // the loop continues — NOT propagated to the re-serve observer, whose
      // policy for kolu-server's default host is to exit the process, and an ssh
      // blip or a padi restart must not do that.
      //
      // What changed is that it is no longer SILENT: the fault already reached
      // `onFault` at error level inside the mirror, and this line names the pump
      // and the spawn. Before, a failing member resolved `done` clean and the one
      // prose line went to a DEBUG sink production dropped.
      //
      // `endedClient` is deliberately NOT set: that variable arms the
      // ended-on-a-live-link probe race, which answers the question "did this
      // mirror end cleanly with the far end still there?". A FAILED mirror has
      // already answered it — the link is bad — so the loop goes straight back to
      // waiting for the next spawn.
      failed = true;
      log(
        `pump: mirror FAILED for client #${seq} — the projection is dead; awaiting the next client to re-mirror: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
    if (failed) continue; // a failed mirror already narrated itself; no probe race
    // Remember WHICH client's mirror ended: the next wait races its liveness
    // verdict, so an ended mirror over a still-answering link stops the pump
    // instead of parking it (see {@link probeEndedLink}).
    endedClient = client;
    log(`pump: mirror ended for client #${seq} — awaiting next client`);
  }
  // The loop exits on EITHER the session's own destruction OR a supervision
  // `close()` (which aborts `opts.signal` but deliberately PRESERVES the
  // caller-owned session — #1719). Name which one so a clean supervised stop
  // never reads as a session teardown that never happened.
  log(
    opts.signal?.aborted
      ? "pump: supervision stop — exiting reconnect loop (session preserved)"
      : "pump: session destroyed — exiting reconnect loop",
  );
}

// ── buildRemotePool — the keyed per-host fan-out ─────────────────────────

/** One host's entry: its session and the served handler a `?host=` dispatcher
 *  upgrades a browser socket onto. The session slot is the minimal
 *  {@link DestroyableSession} (S1) — the registry only ever `destroy()`s it; a
 *  richer type (`Session`) still fits, and the app's `S` is what `getSession`
 *  hands back. `H` stays generic (whatever the app's serving layer hands a socket),
 *  so this package needs no dependency on it. */
export interface RemoteEntry<S extends DestroyableSession, H> {
  session: S;
  handler: H;
}

/** The structural subset of a server-side WebSocket the registry closes on
 *  host removal — kept structural (the `@kolu/surface-app` `GateableSocket`
 *  stance) so this package needn't depend on `ws`. The browser's link re-dials on
 *  its own, so a removal only "sticks" if the parent closes the socket. */
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
   *  (`makeSession`), the re-serve's `{ group, handlers }`, and the serving handler
   *  — all the
   *  surface-specific knowledge the registry deliberately doesn't hold. Sync
   *  (matching `makeSession`, which defers the dial into the session's own
   *  reconnect machinery): a host unreachable at boot surfaces as a per-host
   *  `failed` connection state, never a throw that takes the whole registry down. */
  buildEntry: (host: string) => RemoteEntry<S, H>;
  /** Persist the next host set, awaited BEFORE `add`/`remove` commit their
   *  in-memory + session/socket changes — so a SINGLE mutation's write is
   *  ordered before its own commit. Receives the intended PERSISTED membership
   *  (`persistedMembership`), not necessarily the live pool: after a `retire`
   *  this set can legitimately include a shed-but-remembered host that is NOT
   *  in `hosts()`/`has()`. A persist implementation must therefore treat its
   *  argument as the authoritative remembered set — never cross-check it
   *  against live membership or prune per-host state for hosts it omits.
   *  `add`/`remove` themselves are additionally
   *  serialized through one internal queue (`enqueueMutation`), so this is
   *  never invoked concurrently with itself — two `add`s (or an add+remove)
   *  fired without awaiting between them persist and commit ONE AT A TIME, each
   *  reading the state the prior one left, rather than racing off the same
   *  stale pre-mutation snapshot and losing whichever host's write lands first.
   *  Omit for a static host set. */
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
  /** The host's entry — its served handler (what a `?host=` upgrade dispatcher
   *  hands the browser socket) plus its session — or `undefined` for an
   *  unknown host. Returns the whole {@link RemoteEntry}, not a bare `H`:
   *  `H` is an open type parameter a caller may instantiate with a value
   *  space that itself contains `undefined` (kolu's own local pool builds
   *  `RemoteEntry<PadiSession, undefined>`), so a bare `H | undefined`
   *  return can't tell "unknown host" from "registered host whose real
   *  handler value IS `undefined`". Wrapping in the entry means membership
   *  is signalled by ENTRY presence, never by the handler's own value —
   *  read `.handler` off the result. */
  getHandler(host: string): RemoteEntry<S, H> | undefined;
  /** The host's session (its connection lifecycle), or `undefined` if unknown. */
  getSession(host: string): S | undefined;
  /** Spawn a new host's entry and persist. Throws if the host already exists
   *  (a key collision, not a re-add). */
  add(host: string): Promise<void>;
  /** USER-intent removal: persist the departure (the `persist` hook fires), then
   *  close any open browser sockets, drop membership, and destroy the session.
   *  No-op for an unknown host. Contrast {@link RemotePool.retire}, which does the
   *  same teardown WITHOUT persisting — the two verbs are the "which fact is this"
   *  split (a user removing a host vs the pool shedding a dead one), not one verb
   *  with a `persist` flag. */
  remove(host: string): Promise<void>;
  /** INTERNAL retirement: the SAME teardown as {@link RemotePool.remove} but it does
   *  NOT persist and leaves the intended-persisted membership intact — the host leaves
   *  the LIVE pool yet stays in the persisted set, and (crucially) STAYS there across
   *  every later `add`/`remove`, so a membership store re-seeds it on the next boot. For
   *  a host the pool sheds on its OWN initiative (a dead session / re-serve pump fault),
   *  not because the user asked — retiring it must not be mistaken for the user's
   *  explicit remove, which is the only thing that should forget a host. No-op for an
   *  unknown host. A registry with no `persist` hook makes `retire` and `remove` behave
   *  the same ON DISK (neither writes anything) — but they still differ on the wire:
   *  the socket closes with reason `host retired` vs `host removed`, and the log line
   *  names the verb. */
  retire(host: string): Promise<void>;
  /** Track an open browser socket for `host` so a teardown can close it — either
   *  `remove(host)` or `retire(host)` (both run the shared teardown that closes it). */
  registerConnection(host: string, ws: ClosableSocket): void;
  /** Stop tracking a socket once it has closed on its own. */
  unregisterConnection(host: string, ws: ClosableSocket): void;
  /** Destroy every host's session (server shutdown). */
  destroyAll(): void;
  /** Subscribe to LIVE-MEMBERSHIP changes (add / remove / retire / destroyAll — every
   *  verb that mutates `entries`, retirement included). `onChange` fires only AFTER
   *  `hosts()`/`has()` reflect the change (the ordering clause a `SurfaceMap`'s `entries`
   *  republish depends on); the returned fn unsubscribes. A throwing listener is isolated
   *  at the fan-out — it never aborts the other listeners nor escapes the mutation.
   *  Per-session STATUS transitions are NOT emitted here — an observer that needs
   *  them (the `serveHostMap` adapter) fuses this with each session's own `onState`. */
  subscribe(onChange: () => void): () => void;
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
  const membershipListeners = new Set<() => void>();

  // Serialize EVERY persist-mutating operation (`add`/`remove`) through ONE
  // writer: a chained promise queue, so each mutation's "read `entries` → compute
  // the next persisted list → persist → commit" sequence runs to completion
  // before the NEXT queued mutation reads `entries` at all. Without this, two
  // concurrent `add`s (or an add+remove — a browser double-click races exactly
  // this) each snapshot `entries.keys()` BEFORE their own `await persistHosts(…)`
  // and commit AFTER it, with no ordering between them: the LAST persist to land
  // wins and can overwrite an earlier mutation's write, silently dropping a host
  // from disk that `hosts()` (in memory) still reports — the `persist`
  // docstring's "transactional" claim was false under concurrency. `enqueueMutation`
  // makes "one mutation in flight at a time" a structural invariant instead of a
  // hope.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const enqueueMutation = <T>(task: () => Promise<T>): Promise<T> => {
    // Run `task` after the queue settles, REGARDLESS of whether the prior
    // mutation resolved or rejected (`task` as both the fulfill and reject
    // handler) — so one failed mutation doesn't wedge every later one behind a
    // permanently-rejected queue. `result` is what THIS caller awaits (and can
    // reject with THIS mutation's own error); `mutationQueue` is a separate,
    // always-settling tracker so the NEXT enqueued mutation waits for `result`
    // without inheriting its rejection.
    const result = mutationQueue.then(task, task);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  // Fire membership listeners AFTER the `entries` Map is mutated — so a listener
  // reading `hosts()`/`has()` sees the change the notification announces (ordering).
  // Each listener is isolated: one listener's throw (e.g. a `serveHostMap`
  // reconcile/fire faulting) must not abort the fan-out (the rest still fire) NOR
  // propagate OUT of the notification — a teardown notifies from `tearDownEntry`, and
  // `retire` runs fire-and-forget (`void pool.retire(h)`), so an escaping listener throw
  // would float an unhandledRejection → the server's fatal handler. Surface the fault
  // loudly (never silently swallow), then carry on — the same teardown-fault treatment a
  // throwing `session.destroy()` already gets.
  const notifyMembership = (): void => {
    for (const l of [...membershipListeners]) {
      try {
        l();
      } catch (err) {
        log(`membership listener threw (ignored): ${err}`);
      }
    }
  };

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

  // The INTENDED-PERSISTED membership — the set the `persist` hook writes, tracked as
  // its OWN ordered value rather than derived from live `entries.keys()`. They usually
  // move together (add inserts into both, remove deletes from both), but `retire`
  // deliberately DIVERGES them: it drops a host from live `entries` while LEAVING it in
  // `persistedMembership`, so a shed-but-remembered host survives every LATER add/remove
  // (which persist THIS set, not the live keys) until a reboot re-seeds it. Deriving
  // persist from `entries.keys()` instead would silently drop a retired host on the very
  // next mutation — the contract `retire` promises would hold only until the next click.
  const persistedMembership = new Set(opts.initialHosts);

  // Persist the GIVEN next-host list (the intended-persisted set, NOT `entries.keys()`)
  // so the on-disk store can be written BEFORE the in-memory + session/socket lifecycle
  // is committed — the ordering that makes `add`/`remove` transactional. A no-`persist`
  // registry (a static host set) skips straight to the commit.
  const persistHosts = async (nextHosts: string[]): Promise<void> => {
    if (opts.persist) await opts.persist(nextHosts);
  };

  // The destructive teardown shared by `remove` (which persists first) and `retire`
  // (which does not): close the host's browser sockets, drop membership + notify, then
  // destroy the session LAST. `verb` labels BOTH the WebSocket close reason (`host
  // removed` / `host retired`) and the log line — the two callers otherwise differ
  // solely in whether they `persistHosts` before calling this.
  //
  // Ordering is load-bearing: membership is dropped + notified BEFORE `session.destroy()`,
  // so `has(host)` is already false when the destroy fault reaches the map's
  // `forwardStream` — its error→typed-end guard fires and each delta/fail-through stream
  // ends TYPED, never a raw session-death failure reaching the browser (and it honors
  // the MapRegistry clause that `has()` reflects the change before `onChange` fires). The
  // destroy throw is SWALLOWED: kolu sheds a guest fire-and-forget (`void pool.retire(h)`),
  // so an unguarded throw here would float an unhandledRejection → the server's fatal
  // handler → `process.exit(1)`, crashing the WHOLE server on ONE guest's teardown fault.
  const tearDownEntry = (
    host: string,
    entry: RemoteEntry<S, H>,
    verb: "removed" | "retired",
  ): void => {
    const sockets = socketsByHost.get(host);
    if (sockets !== undefined) {
      for (const ws of sockets) {
        try {
          ws.close(1000, `host ${verb}`);
        } catch {
          /* best-effort — a socket already closing is fine */
        }
      }
      socketsByHost.delete(host);
    }
    entries.delete(host);
    log(`${verb} host: ${host} (total ${entries.size})`);
    notifyMembership();
    try {
      entry.session.destroy();
    } catch (err) {
      log(
        `host ${host} session destroy threw during ${verb} (ignored): ${err}`,
      );
    }
  };

  const registry: RemotePool<S, H> = {
    has: (host) => entries.has(host),
    hosts: () => [...entries.keys()],
    getHandler: (host) => entries.get(host),
    getSession: (host) => entries.get(host)?.session,

    add(host) {
      // Queued: the `entries.has`/`entries.keys()` reads below now see EXACTLY
      // what the prior mutation committed — never a snapshot racing another
      // in-flight add/remove.
      return enqueueMutation(async () => {
        if (entries.has(host)) throw new Error("host already exists");
        // Build the entry up front (so a `buildEntry` throw aborts before any
        // commit), but persist the next host set BEFORE inserting it. If persist
        // rejects, tear the just-built session down and DON'T insert.
        const entry = opts.buildEntry(host);
        try {
          // Dedup: re-adding a host that was RETIRED (gone from live `entries` but still
          // in `persistedMembership`) must not write it twice — a duplicate would trip a
          // membership store's own no-dupes invariant.
          await persistHosts([...new Set([...persistedMembership, host])]);
        } catch (err) {
          // Best-effort rollback teardown — `session.destroy()` CAN throw (it kills the ssh child
          // + clears timers; see dialAgentOnce.ts), and that must NOT pre-empt `throw err`: the
          // persist rejection is the failure the caller needs to see, not a teardown hiccup.
          try {
            entry.session.destroy();
          } catch {
            /* best-effort rollback */
          }
          throw err;
        }
        persistedMembership.add(host);
        entries.set(host, entry);
        log(`added host: ${host} (total ${entries.size})`);
        notifyMembership();
      });
    },

    remove(host) {
      // Queued alongside `add`/`retire` — see `enqueueMutation`: the same single
      // writer serializes them all (a remove racing an add for a DIFFERENT host must
      // not persist off the other's pre-commit snapshot either).
      return enqueueMutation(async () => {
        const entry = entries.get(host);
        // No-op ONLY when the host is unknown to BOTH the live pool AND the remembered
        // set. A host `retire`d earlier is gone from `entries` but STILL in
        // `persistedMembership` (that's the shed-but-remembered contract); a user's
        // explicit remove is the one and only verb that forgets a host, so it MUST still
        // persist the departure and drop the remembered claim even though no live entry
        // remains — otherwise the authoritative user intent is silently lost and the
        // retired host re-seeds next boot. (`entries` is always a subset of
        // `persistedMembership`, so `has` on the remembered set is the whole test.)
        if (!persistedMembership.has(host)) return;
        // USER intent — persist the post-removal set FIRST. If it rejects, the host
        // stays fully as it was (any live session intact, sockets open, still in
        // `persistedMembership`) and matches the disk that still lists it — no
        // destroy-but-still-on-disk split.
        await persistHosts([...persistedMembership].filter((h) => h !== host));
        // Persisted: drop it from the intended set, then commit the destructive teardown —
        // but only when a live entry actually remains (a retired host has none left to
        // tear down; forgetting it is the whole job here).
        persistedMembership.delete(host);
        if (entry !== undefined) tearDownEntry(host, entry, "removed");
      });
    },

    retire(host) {
      // The internal twin of `remove` — see the `retire` interface doc for the full
      // contract. Here, the two load-bearing impl facts: it leaves `persistedMembership`
      // UNTOUCHED and never persists (so the shed host stays remembered); and it has no
      // step that can reject (no persist; the teardown swallows its destroy fault and
      // `notifyMembership` isolates listener throws), so a fire-and-forget
      // `void pool.retire(h)` needs no `.catch` to stay off the fatal handler.
      return enqueueMutation(async () => {
        const entry = entries.get(host);
        if (entry === undefined) return;
        tearDownEntry(host, entry, "retired");
      });
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
      // Mirror `remove()`'s ordering + guard: snapshot, then drop membership + notify
      // BEFORE destroying any session (so a live `forwardStream` sees `has(host) ===
      // false` and ends each stream TYPED, never a raw session-death failure), and
      // destroy each snapshotted session inside its OWN try/catch (`session.destroy()`
      // CAN throw — it kills the ssh child + clears timers) so one throwing teardown
      // can't abort the loop and strand the rest un-destroyed.
      const snapshot = [...entries.entries()];
      entries.clear();
      socketsByHost.clear();
      notifyMembership();
      for (const [host, entry] of snapshot) {
        try {
          entry.session.destroy();
        } catch (err) {
          log(
            `host ${host} session destroy threw during destroyAll (ignored): ${err}`,
          );
        }
      }
    },

    subscribe(onChange) {
      membershipListeners.add(onChange);
      return () => {
        membershipListeners.delete(onChange);
      };
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
