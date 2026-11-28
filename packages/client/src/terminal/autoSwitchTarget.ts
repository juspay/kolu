/** Which sibling does focus fall to when the active tile goes away.
 *
 *  A LEAF module: it imports nothing but the id type, because both of its
 *  callers sit on opposite sides of an import cycle — the per-host view state
 *  (`hostScope/createViewState`, which answers the fallback as a DERIVATION of
 *  the census) and the list-driven removal reconcile
 *  (`terminal/useActiveReconcile`, which performs the activation's imperative
 *  half). One policy, one home, no cycle. */

import type { TerminalId } from "kolu-common/surface";

/** Pick the tile that inherits focus when the active tile is removed: the
 *  survivor now occupying the removed tile's slot (its old index in the FULL
 *  pre-removal order, clamped to the new last), or `null` when none remain. Owns
 *  the WHOLE focus-fallback policy from raw facts — `topLevelBefore` is the
 *  pre-removal top-level order (still containing `removedId`), `departing` is
 *  every id leaving this frame, and `removedId` is the tile being processed. It
 *  derives the survivor set itself (`topLevelBefore` minus `removedId` and
 *  everyone else departing), so no caller can drift the filter predicate or the
 *  filtered-list/unfiltered-index cross-argument invariant that carried the #1667
 *  bug. The removed tile is provably never its own successor regardless of what
 *  `departing` contains; a `removedId` that was never top-level (`indexOf` of
 *  `-1`) yields `null`. */
export function pickAutoSwitchTarget(
  topLevelBefore: readonly TerminalId[],
  departing: ReadonlySet<TerminalId>,
  removedId: TerminalId,
): TerminalId | null {
  const survivors = topLevelBefore.filter(
    (x) => x !== removedId && !departing.has(x),
  );
  return (
    survivors[
      Math.min(topLevelBefore.indexOf(removedId), survivors.length - 1)
    ] ?? null
  );
}
