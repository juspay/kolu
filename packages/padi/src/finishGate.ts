/**
 * The EFFECTIVE-finish gate — turns a raw `waiting` agent state into an HONEST
 * "the turn is actually done" by fusing agent state with terminal QUIET.
 *
 * The problem: an agent (Claude Code is the motivating case) can mark its turn
 * `waiting` while background sub-agents keep working. The transcript can't catch
 * this — but the terminal is still MOVING BYTES while the sub-agents run. So a raw
 * `waiting` is a premature "finished": kolu would chime and drop a dot before the
 * work is done.
 *
 * The fix, all padi-side (padi sees every terminal's bytes, active OR background —
 * the client live-dot only tracks attached tiles, so it can't own a cross-host
 * fact): a `waiting` terminal is EFFECTIVELY finished only once its PTY has gone
 * quiet for {@link EFFECTIVE_FINISH_QUIET_MS}. The gate byte-taps ONLY the
 * `waiting` terminals (a small, bounded set — a finished agent emits little, save
 * the background case this exists to catch — NOT liveActivity's tap-every-active
 * cost), debounces each on the shared {@link createActivityTracker}, and publishes
 * the SETTLED set into the reactor graph. `recomputeUrgency` reads it and admits a
 * `waiting` terminal to `finishedIds` only when settled.
 *
 * DEFAULT-EXCLUDED is what makes it race-free: a terminal that just flipped to
 * `waiting` is not yet in the settled set, so urgency holds it back until the gate
 * has affirmatively watched it fall quiet — a late observation only DELAYS a finish
 * (the lesser, non-blocking nudge), it can never fire one early. The ASKING path
 * (`awaiting_user`) is never gated here — it is blocking and actionable, so it
 * fires at once.
 *
 * "Output stopped" is a non-event on the wire, so the gate carries its own debounce
 * TIMER (inside the tracker): when a waiting terminal crosses the quiet threshold
 * the tracker's change fires and the gate re-publishes, re-folding urgency.
 *
 * The transport is INJECTED (`listWaiting` reads the registry; `openTap` opens a
 * byte tap) so this debounce core is a pure, unit-testable leaf that knows nothing
 * of the endpoint or the wire.
 */

import { source } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import {
  type ActivityTracker,
  createActivityTracker,
} from "./terminalActivityTracker.ts";

/** How long a `waiting` terminal's PTY must stay quiet before it counts as an
 *  EFFECTIVE finish. Long enough to ride over the gaps between a background
 *  sub-agent's output bursts (so a still-working agent isn't mistaken for done),
 *  short enough that a genuinely-finished agent's dot/chime isn't noticeably late.
 *  The ASKING path is never debounced — this delays only the lesser finish nudge. */
export const EFFECTIVE_FINISH_QUIET_MS = 5_000;

/** How often the gate re-reads the registry to reconcile which terminals are
 *  `waiting` (agent-state transitions don't pulse `terminals:dirty`). Well under
 *  the quiet window, so the reconcile lag is dwarfed by the debounce it feeds. */
export const WAITING_RECONCILE_INTERVAL_MS = 1_000;

const EMPTY: ReadonlySet<TerminalId> = new Set();

/** Compare two id sets for equality (order-independent) — the emit dedup. */
function sameIdSet(
  a: ReadonlySet<TerminalId>,
  b: ReadonlySet<TerminalId>,
): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The callbacks a byte tap reports to the debounce core. The quiet window only
 *  starts from `onReady` (attach established) — not from the tap being requested —
 *  so a slow/wedged attach can never let a terminal settle without a live observer. */
export interface TapHandlers {
  /** The attach has ESTABLISHED — a live observer now exists, so the quiet window
   *  may start. Until this fires the terminal cannot settle (it is being observed
   *  by nothing yet). */
  onReady: () => void;
  /** An output chunk landed (the FACT of bytes, never the bytes) — re-arm the quiet
   *  window and clear any settled level (real output un-settles). */
  onOutput: () => void;
  /** The tap ENDED ON ITS OWN — a graceful stream end or a transient kaval drop, NOT
   *  the returned disposer (which the core calls when the terminal leaves `waiting`).
   *  The core drops the dead tap and re-opens it at the next reconcile, so a
   *  still-`waiting` terminal always keeps an observer. */
  onClosed: () => void;
}

/** The gate's transport seam — the two volatile capabilities it stands on, injected
 *  so the debounce core stays pure. `L` is the opaque tap location (an endpoint
 *  routing key); the gate never inspects it, only threads it from `listWaiting` to
 *  `openTap`. */
export interface FinishGateDeps<L> {
  /** Every terminal currently `waiting` (active + agent bucket `waiting`), mapped to
   *  its tap location. Re-read each reconcile. */
  listWaiting: () => Map<TerminalId, L>;
  /** Open a byte tap for `id`, reporting through {@link TapHandlers}. Return a
   *  disposer that closes the tap (the core calls it when the terminal leaves
   *  `waiting`). */
  openTap: (id: TerminalId, location: L, handlers: TapHandlers) => () => void;
  /** Subscribe to agent-bucket TRANSITIONS (`isWaiting` = the agent is in the
   *  `waiting` bucket now). This is the RELIABLE episode edge — it fires on every
   *  agent-state change (the commit firehose), so it never misses a fast
   *  `waiting → working → waiting` cycle the reconcile poll would. It is what makes
   *  a NEW waiting episode earn a fresh quiet window instead of inheriting the prior
   *  episode's settled level. Return an unsubscribe. */
  subscribeAgentObservations: (
    onObserve: (id: TerminalId, isWaiting: boolean) => void,
  ) => () => void;
  /** Override the quiet window (tests). Defaults to {@link EFFECTIVE_FINISH_QUIET_MS}. */
  quietMs?: number;
  /** Override the reconcile cadence (tests). Defaults to
   *  {@link WAITING_RECONCILE_INTERVAL_MS}. */
  reconcileMs?: number;
}

export interface FinishGate {
  /** The set of `waiting` terminals whose PTY has settled quiet — an ENGINE-TRACKED
   *  read (backed by a reactor source), so reading it inside the `urgency` compute
   *  makes the fold recompute when a terminal crosses the quiet threshold. */
  settledFinished(): ReadonlySet<TerminalId>;
  /** Tear down every tap, timer, and the reconcile loop. */
  dispose(): void;
}

/** Build the effective-finish gate. The reactor `source` is the conduit that pushes
 *  the settled set into the graph; the gate keeps it installed for its own lifetime
 *  with a single self-subscription (the `urgency` compute reads the source's LEVEL,
 *  which is not itself a subscription), and tears it down on `dispose`. */
export function createFinishGate<L>(deps: FinishGateDeps<L>): FinishGate {
  const quietMs = deps.quietMs ?? EFFECTIVE_FINISH_QUIET_MS;
  const reconcileMs = deps.reconcileMs ?? WAITING_RECONCILE_INTERVAL_MS;

  const src = source<ReadonlySet<TerminalId>>((emit) => {
    // The debounce core. `tracker` is the shared quiet-window timer (windowed to
    // `quietMs`); `tracked` maps each tapped terminal to its location (kept so a
    // dropped tap can be RE-OPENED); `attached` is the terminals whose CURRENT tap
    // has actually reported `onReady` (a live observer exists) — set ONLY by an
    // attach, never manufactured; `settled` is the STICKY finished set — a terminal
    // enters it when the quiet window elapses while attached, and leaves it ONLY on
    // real output. Keeping `settled` explicit (not derived from `!isLive`) is what
    // lets a settled terminal survive a transient tap drop without a finishedIds
    // flicker while STILL re-observing resumed output.
    const tracker: ActivityTracker = createActivityTracker(quietMs);
    const tracked = new Map<TerminalId, L>();
    const taps = new Map<TerminalId, () => void>();
    // Per-open tap GENERATION — a monotonic token stamped on each `openTapFor`. Every
    // handler is fenced to the token it was opened under, so a late callback from an
    // aborted/replaced tap (e.g. an aborted attach resolving through the
    // endpoint's empty-attachment path) can never mutate the CURRENT tap's state.
    const tapGen = new Map<TerminalId, number>();
    let tapSeq = 0;
    // `attached` is the TRUE "a live observer exists" fact — set only by the current
    // tap's `onReady`/`onOutput`, so a settle can never happen without an established
    // attach (a pending or closed tap is NOT attached, so it cannot settle).
    const attached = new Set<TerminalId>();
    const settled = new Set<TerminalId>();
    // Terminals that LEFT `waiting` and are awaiting re-arm — a fast
    // `waiting → working → waiting` blip the poll misses is caught by the
    // agent-observation edge, which drops the stale settled/quiet state on leave and
    // re-arms a fresh window on re-entry (so turn 2 never inherits turn 1's settle).
    // While a terminal is in this set it is OUT of its waiting episode and cannot
    // settle.
    const awaitingRearm = new Set<TerminalId>();
    let lastEmitted: ReadonlySet<TerminalId> = EMPTY;

    const publish = (): void => {
      // `settled` only ever holds tracked ids (adds gate on `tracked`, stop/close
      // prune it), so it IS the settled-finished set. Compare the live set first and
      // snapshot ONLY on a real change — `reconcile` publishes every ~1s and the
      // common case is no-change, so this skips a throwaway Set copy on that path.
      if (sameIdSet(settled, lastEmitted)) return;
      lastEmitted = new Set(settled); // immutable snapshot, decoupled from later mutation
      emit(lastEmitted);
    };

    const openTapFor = (id: TerminalId, location: L): void => {
      const gen = ++tapSeq;
      tapGen.set(id, gen);
      const current = (): boolean => tracked.has(id) && tapGen.get(id) === gen;
      taps.set(
        id,
        deps.openTap(id, location, {
          // Attach established — a live observer now exists. START the quiet window
          // HERE (not when the tap was requested), so a slow/wedged attach can never
          // let a terminal settle before anything actually watched it. Fenced to this
          // tap's generation, so an aborted tap's late `onReady` can't ready a newer one.
          onReady: () => {
            if (!current()) return;
            attached.add(id);
            // Don't start a window for a terminal that is BETWEEN waiting episodes
            // (left waiting, not yet re-entered) — it must wait for its re-entry.
            if (!awaitingRearm.has(id)) tracker.noteOutput(id);
          },
          // Real output — re-arm the window and clear any settled level (resumed
          // output un-settles, even on a terminal that had already finished).
          onOutput: () => {
            if (!current()) return;
            attached.add(id); // output implies the attach is live
            tracker.noteOutput(id);
            if (settled.delete(id)) publish();
          },
          // The tap ended on its own (graceful end / transient kaval drop) — drop it
          // (KEEP the sticky `settled` level, so a finished terminal doesn't flicker)
          // and let the next reconcile re-open it. Re-tapping at the poll — not
          // inline here — bounds a terminal whose attach ends immediately to one
          // re-tap per reconcile instead of a hot loop. `tracker.forget` drops the
          // stale quiet timer so a NOT-yet-settled terminal can't settle off a dead
          // tap during the gap (it re-seeds on the next attach's `onReady`).
          onClosed: () => {
            if (!current()) return; // our disposer / replaced / already stopped
            attached.delete(id); // the observer is gone — a replacement must re-attach
            taps.delete(id);
            tracker.forget(id);
          },
        }),
      );
    };

    const stopTracking = (id: TerminalId): void => {
      if (!tracked.delete(id)) return;
      taps.get(id)?.();
      taps.delete(id);
      tapGen.delete(id);
      attached.delete(id);
      tracker.forget(id);
      awaitingRearm.delete(id);
      settled.delete(id);
    };

    // The RELIABLE episode edge (the commit firehose). It never misses an agent-state
    // transition, so it is what keeps a NEW waiting episode from inheriting the prior
    // episode's settled level when the reconcile poll misses a sub-interval blip.
    const onObserve = (id: TerminalId, isWaiting: boolean): void => {
      if (!tracked.has(id)) return; // membership is the poll's job; only re-arm what we track
      if (!isWaiting) {
        // Left the waiting episode — invalidate the settle/quiet state so the next
        // waiting turn must earn a fresh window. The tap and its `attached` fact stay
        // (same PTY, same observer). Set `awaitingRearm` FIRST: `tracker.forget`
        // synchronously fires the settle listener (it removes the live flag), and
        // that listener must already see this terminal fenced out of its waiting
        // episode — otherwise it would publish a transient false finish in the gap.
        awaitingRearm.add(id);
        tracker.forget(id);
        if (settled.delete(id)) publish();
      } else if (awaitingRearm.delete(id)) {
        // Re-entered waiting after a blip — re-arm a fresh quiet window, but ONLY if
        // the current tap has actually attached. If it is still pending (or closed),
        // do nothing: its `onReady` (once the current generation attaches) starts the
        // window, so we never manufacture readiness for a tap nothing has observed.
        if (attached.has(id)) tracker.noteOutput(id);
      }
    };

    const reconcile = (): void => {
      const waiting = deps.listWaiting();
      for (const [id, location] of waiting) {
        if (!tracked.has(id)) {
          // A newly-`waiting` terminal — track it and open its tap. It is
          // DEFAULT-EXCLUDED (not ready, not settled) until the attach establishes
          // and a full quiet window then elapses.
          tracked.set(id, location);
          openTapFor(id, location);
        } else if (!taps.has(id)) {
          // A tracked terminal whose tap dropped (onClosed) — re-open it.
          openTapFor(id, location);
        }
      }
      for (const id of [...tracked.keys()])
        if (!waiting.has(id)) stopTracking(id);
      publish();
    };

    // A quiet-window expiry (tracker live→static) settles every terminal that has
    // fallen quiet WHILE attached and inside its waiting episode — the "output
    // stopped" non-event, pushed into the graph. `attached` bars a pending/closed
    // tap; `!awaitingRearm` bars a terminal between waiting episodes.
    const offTracker = tracker.onChange(() => {
      let changed = false;
      for (const id of tracked.keys()) {
        if (
          attached.has(id) &&
          !awaitingRearm.has(id) &&
          !tracker.isLive(id) &&
          !settled.has(id)
        ) {
          settled.add(id);
          changed = true;
        }
      }
      if (changed) publish();
    });
    const offObserve = deps.subscribeAgentObservations(onObserve);
    reconcile();
    const interval = setInterval(reconcile, reconcileMs);
    interval.unref?.();

    return () => {
      clearInterval(interval);
      offTracker();
      offObserve();
      for (const close of taps.values()) close();
      taps.clear();
      tapGen.clear();
      tracked.clear();
      attached.clear();
      settled.clear();
      awaitingRearm.clear();
      tracker.dispose();
    };
  }, EMPTY);

  // Force the lazy install for the gate's lifetime — the `urgency` compute reads
  // the source LEVEL (`settledFinished`), which does not itself subscribe. The
  // returned disposer tears the source down directly, so this subscription's
  // unsubscribe is not load-bearing for cleanup.
  src.subscribe(() => {});

  return {
    settledFinished: () => src.value.value ?? EMPTY,
    // Tear the source down directly — `dispose()` clears listeners and runs
    // teardown unconditionally, so the gate's cleanup no longer depends on the
    // keep-alive being the source's sole subscriber.
    dispose: () => src.dispose(),
  };
}
