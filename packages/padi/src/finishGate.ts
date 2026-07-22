/**
 * The EFFECTIVE-finish gate — a PURE FOLD over two padi-local chronologies, deciding
 * which `waiting` terminals have genuinely gone quiet.
 *
 * The problem: an agent (Claude Code is the motivating case) can mark its turn
 * `waiting` while background sub-agents keep working — the transcript says done, but
 * the terminal is still emitting bytes. So a raw `waiting` is a premature "finished".
 *
 * The fix is two facts, each stamped on padi's OWN clock (so nothing ever compares
 * two hosts' clocks — the attention model is recency-free, see `urgency.ts`):
 *   - `enteredWaitingAt[id]` — when the agent last ENTERED its waiting episode
 *     (the agent-bucket edge; a fresh episode restamps it, so a new turn earns a
 *     fresh window and never inherits the last one's quiet).
 *   - `lastMeaningfulArrivalAt[id]` — when kaval last reported MEANINGFUL output for
 *     this terminal (the host-global `activity` edge). kaval excludes resize
 *     repaints AT THE SOURCE, so a reveal/resize repaint never moves this — the
 *     "visiting un-finishes it" regression is UNSPELLABLE here, structurally.
 *
 * A `waiting` terminal is finished once BOTH have been quiet for the window:
 *
 *     finished(id) = now − max(enteredWaitingAt, lastMeaningfulArrivalAt ?? entered)
 *                    ≥ EFFECTIVE_FINISH_QUIET_MS
 *
 * There is no tap, no observer lifecycle, no settle state machine — just this fold
 * plus a DEADLINE WAKE (a timer at the next crossing, since "stayed quiet" is a
 * non-event). The fold is DEFAULT-EXCLUDED: a terminal with no stamp isn't finished,
 * so a late/lost signal only DELAYS a finish, never fires one early. The ASKING path
 * (`awaiting_user`) is never gated here — it is blocking and fires at once.
 */

import { source } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

/** How long BOTH chronologies must be quiet before a `waiting` terminal counts as an
 *  EFFECTIVE finish. Long enough to ride over the gaps between a background
 *  sub-agent's output bursts, short enough that a genuinely-finished agent's dot/chime
 *  isn't noticeably late. Only the (lesser) finish nudge is debounced — never ASKING. */
export const EFFECTIVE_FINISH_QUIET_MS = 5_000;

/** How often the fold re-seeds `enteredWaitingAt` from the registry — a boot/adopt
 *  safety net for a terminal that was ALREADY `waiting` before the agent-bucket edge
 *  could observe a transition. Live transitions ride the edge (never missed). */
export const WAITING_RECONCILE_INTERVAL_MS = 1_000;

const EMPTY: ReadonlySet<TerminalId> = new Set();

/** Order-independent id-set equality — the emit dedup. */
function sameIdSet(
  a: ReadonlySet<TerminalId>,
  b: ReadonlySet<TerminalId>,
): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The gate's inputs — all padi-local, injected so the fold is a pure, unit-testable
 *  leaf that knows nothing of kaval or the registry. */
export interface FinishGateDeps {
  /** Terminals currently `waiting` (active + agent bucket `waiting`) — the boot/adopt
   *  SEED for `enteredWaitingAt` (live transitions ride the agent-bucket edge). */
  listWaiting: () => ReadonlySet<TerminalId>;
  /** The agent-bucket edge: `isWaiting` = the agent is in the `waiting` bucket now.
   *  Fires on every transition (the commit firehose), so a fast
   *  `waiting → working → waiting` blip is never missed. Return an unsubscribe. */
  subscribeAgentObservations: (
    onObserve: (id: TerminalId, isWaiting: boolean) => void,
  ) => () => void;
  /** kaval's MEANINGFUL-OUTPUT edge: this terminal just produced real output (resize
   *  repaints already excluded at the source). Return an unsubscribe. */
  subscribeActivity: (onOutput: (id: TerminalId) => void) => () => void;
  /** Override the quiet window (tests). Defaults to {@link EFFECTIVE_FINISH_QUIET_MS}. */
  quietMs?: number;
  /** Override the reconcile cadence (tests). Defaults to
   *  {@link WAITING_RECONCILE_INTERVAL_MS}. */
  reconcileMs?: number;
}

export interface FinishGate {
  /** The `waiting` terminals whose two chronologies have gone quiet — an
   *  ENGINE-TRACKED read (backed by a reactor source), so reading it inside the
   *  `urgency` compute re-folds when a terminal crosses the quiet threshold. */
  settledFinished(): ReadonlySet<TerminalId>;
  /** Tear down the subscriptions, the reconcile loop, and the deadline wake. */
  dispose(): void;
}

/** Build the effective-finish gate. The reactor `source` is the conduit that pushes
 *  the settled set into the graph; one self-subscription keeps it installed for the
 *  gate's lifetime (the `urgency` compute reads the source LEVEL, not a subscription),
 *  and `dispose()` tears the source down directly. */
export function createFinishGate(deps: FinishGateDeps): FinishGate {
  const quietMs = deps.quietMs ?? EFFECTIVE_FINISH_QUIET_MS;
  const reconcileMs = deps.reconcileMs ?? WAITING_RECONCILE_INTERVAL_MS;

  const src = source<ReadonlySet<TerminalId>>((emit) => {
    // The two chronologies. `enteredWaitingAt` is ALSO the membership set — an id is
    // in a waiting episode iff it is a key here.
    const enteredWaitingAt = new Map<TerminalId, number>();
    const lastMeaningfulArrivalAt = new Map<TerminalId, number>();
    let lastEmitted: ReadonlySet<TerminalId> = EMPTY;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    /** The finish quiet-until wall time for one waiting terminal. */
    const quietUntil = (id: TerminalId, entered: number): number => {
      const last = lastMeaningfulArrivalAt.get(id) ?? entered;
      return Math.max(entered, last) + quietMs;
    };

    /** The pure fold: every waiting terminal whose window has elapsed. */
    const foldSettled = (now: number): Set<TerminalId> => {
      const settled = new Set<TerminalId>();
      for (const [id, entered] of enteredWaitingAt) {
        if (now >= quietUntil(id, entered)) settled.add(id);
      }
      return settled;
    };

    /** Re-fold, emit on change, and (re)schedule the next deadline wake — because
     *  "stayed quiet" is a non-event, a terminal crosses the threshold with no signal,
     *  so a timer fires the re-fold at the earliest crossing. */
    const publish = (): void => {
      const now = Date.now();
      const next = foldSettled(now);
      if (!sameIdSet(next, lastEmitted)) {
        lastEmitted = next;
        emit(next);
      }
      if (deadline) clearTimeout(deadline);
      deadline = undefined;
      let earliest = Number.POSITIVE_INFINITY;
      for (const [id, entered] of enteredWaitingAt) {
        const until = quietUntil(id, entered);
        if (until > now) earliest = Math.min(earliest, until);
      }
      if (earliest !== Number.POSITIVE_INFINITY) {
        deadline = setTimeout(publish, earliest - now);
        deadline.unref?.();
      }
    };

    const onObserve = (id: TerminalId, isWaiting: boolean): void => {
      if (isWaiting) {
        // A FRESH waiting episode — stamp its start (only if not already in one, so a
        // same-bucket re-observation doesn't restart the window).
        if (!enteredWaitingAt.has(id)) {
          enteredWaitingAt.set(id, Date.now());
          publish();
        }
      } else {
        // Left the episode — drop both chronologies so a later re-entry earns a fresh
        // window and nothing stale can settle it.
        if (enteredWaitingAt.delete(id)) {
          lastMeaningfulArrivalAt.delete(id);
          publish();
        }
      }
    };

    const onActivity = (id: TerminalId): void => {
      // Only a currently-waiting terminal's window is affected; a resize repaint never
      // reaches here (kaval excluded it), so this only ever fires on REAL output.
      if (!enteredWaitingAt.has(id)) return;
      lastMeaningfulArrivalAt.set(id, Date.now());
      publish(); // un-settles if it had settled, and pushes the deadline out
    };

    const reconcile = (): void => {
      const waiting = deps.listWaiting();
      const now = Date.now();
      // Seed a waiting terminal the edge never announced (already-waiting at boot/adopt).
      for (const id of waiting) {
        if (!enteredWaitingAt.has(id)) enteredWaitingAt.set(id, now);
      }
      // Drop a stamp for a terminal no longer waiting (a leave the edge missed).
      for (const id of [...enteredWaitingAt.keys()]) {
        if (!waiting.has(id)) {
          enteredWaitingAt.delete(id);
          lastMeaningfulArrivalAt.delete(id);
        }
      }
      publish();
    };

    const offObserve = deps.subscribeAgentObservations(onObserve);
    const offActivity = deps.subscribeActivity(onActivity);
    reconcile();
    const interval = setInterval(reconcile, reconcileMs);
    interval.unref?.();

    return () => {
      clearInterval(interval);
      offObserve();
      offActivity();
      if (deadline) clearTimeout(deadline);
      enteredWaitingAt.clear();
      lastMeaningfulArrivalAt.clear();
    };
  }, EMPTY);

  // Force the lazy install for the gate's lifetime — the `urgency` compute reads the
  // source LEVEL (`settledFinished`), which does not itself subscribe.
  src.subscribe(() => {});

  return {
    settledFinished: () => src.value.value ?? EMPTY,
    dispose: () => src.dispose(),
  };
}
