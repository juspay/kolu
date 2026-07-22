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

/** The gate's transport seam — the two volatile capabilities it stands on, injected
 *  so the debounce core stays pure. `L` is the opaque tap location (an endpoint
 *  routing key); the gate never inspects it, only threads it from `listWaiting` to
 *  `openTap`. */
export interface FinishGateDeps<L> {
  /** Every terminal currently `waiting` (active + agent bucket `waiting`), mapped to
   *  its tap location. Re-read each reconcile. */
  listWaiting: () => Map<TerminalId, L>;
  /** Open a byte tap for `id`: invoke `onOutput` on each output chunk (the FACT of
   *  bytes, never the bytes), and `onClosed` if the tap ENDS ON ITS OWN (a graceful
   *  stream end or a transient kaval drop — NOT the returned disposer, which the
   *  core calls when the terminal leaves `waiting`). Return a disposer that closes
   *  the tap. `onClosed` is the recovery seam: a tap that dies while its terminal is
   *  still `waiting` must not be believed alive, or the core would see no more output
   *  and falsely settle the terminal — so the core drops it and the next reconcile
   *  re-taps with a fresh quiet window. */
  openTap: (
    id: TerminalId,
    location: L,
    onOutput: () => void,
    onClosed: () => void,
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
    // The debounce core: a shared activity tracker windowed to `quietMs`, the set of
    // terminals we're tapping, and the last set we emitted (for dedup).
    const tracker: ActivityTracker = createActivityTracker(quietMs);
    const tracked = new Set<TerminalId>();
    const taps = new Map<TerminalId, () => void>();
    let lastEmitted: ReadonlySet<TerminalId> = EMPTY;

    /** A tracked terminal is SETTLED when it is no longer live — no output for the
     *  quiet window. A freshly-tracked terminal is seeded live (below), so it is
     *  excluded until it actually falls quiet. */
    const currentSettled = (): ReadonlySet<TerminalId> => {
      const settled = new Set<TerminalId>();
      for (const id of tracked) if (!tracker.isLive(id)) settled.add(id);
      return settled;
    };

    const publish = (): void => {
      const next = currentSettled();
      if (sameIdSet(next, lastEmitted)) return;
      lastEmitted = next;
      emit(next);
    };

    // A tap that ENDED ON ITS OWN (a graceful stream end / transient kaval drop,
    // not our disposer) while the terminal is still `waiting`: drop it so the next
    // reconcile RE-TAPS with a fresh quiet window. Without this the core keeps
    // believing it's watching, sees no more output, and the tracker timer falsely
    // settles the terminal — a premature finish, the exact harm this gate prevents.
    // Forgetting holds it OUT of the settled set during the observation gap
    // (default-excluded), so recovery only ever DELAYS a finish, never fires one.
    const onTapClosed = (id: TerminalId): void => {
      if (!tracked.has(id)) return; // already stopped by us (terminal left `waiting`)
      // If it ALREADY settled (observed quiet a full window on a live tap), it is
      // genuinely finished — the debounce is done and a tap drop now doesn't
      // un-finish it; leave it settled (no flicker). Recover ONLY a still-live
      // terminal, where we would otherwise conclude quiet from a dead tap.
      if (!tracker.isLive(id)) return;
      tracked.delete(id);
      taps.delete(id);
      tracker.forget(id);
      publish();
    };

    const startTracking = (id: TerminalId, location: L): void => {
      if (tracked.has(id)) return;
      tracked.add(id);
      // Seed the quiet window: a just-flipped-to-`waiting` terminal is treated as
      // live for one `quietMs`, so it can't settle before we've watched it stay
      // silent (and can't fire early if a background burst is about to land).
      tracker.noteOutput(id);
      const close = deps.openTap(
        id,
        location,
        () => {
          tracker.noteOutput(id);
          publish();
        },
        () => onTapClosed(id),
      );
      taps.set(id, close);
    };

    const stopTracking = (id: TerminalId): void => {
      if (!tracked.delete(id)) return;
      taps.get(id)?.();
      taps.delete(id);
      tracker.forget(id);
    };

    const reconcile = (): void => {
      const waiting = deps.listWaiting();
      for (const [id, location] of waiting) startTracking(id, location);
      for (const id of [...tracked]) if (!waiting.has(id)) stopTracking(id);
      publish();
    };

    // A quiet-threshold crossing (a tracker timer expiring) is the non-event that
    // makes a terminal settle — re-publish so urgency re-folds.
    const offTracker = tracker.onChange(publish);
    reconcile();
    const interval = setInterval(reconcile, reconcileMs);
    interval.unref?.();

    return () => {
      clearInterval(interval);
      offTracker();
      for (const close of taps.values()) close();
      taps.clear();
      tracked.clear();
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
