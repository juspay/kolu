/** The fleet section's derivation — which of the orchestrator's terminals still
 *  exist, how they stand, and how many of them are blocked on a person.
 *
 *  `state.fleet` is MEMBERSHIP, deliberately: padi records which terminals this
 *  conversation created or spoke to, and nothing else. Every live fact a row
 *  shows — the pip, the agent state, the intent, the recency — is read from the
 *  terminals collection and the urgency cell at render time, which is why this
 *  fold takes rows the dock's own ranking already produced rather than anything
 *  the agent remembers. A terminal the agent made and somebody then killed
 *  simply has no record, and drops out here instead of drawing a row about a
 *  terminal that is gone. */

import type { TerminalId } from "kolu-common/surface";

/** The half of a ranked dock row this fold reads. Spelled structurally so the
 *  tests drive it without building a whole `TerminalMetadata`. */
export interface FleetRowFacts {
  readonly id: TerminalId;
}

export interface FleetView<R extends FleetRowFacts> {
  readonly rows: readonly R[];
  /** The fleet's terminals blocked on a human, in row order — what `N asking`
   *  counts and what `N needs you ›` walks. */
  readonly needsYou: readonly TerminalId[];
  readonly working: number;
}

/** Fold the ranked rows of a fleet into what the section header and the rows
 *  need. Both counts are INTERSECTIONS with the host's own attention frame
 *  (`byClass.asking`, `byClass.working`) rather than anything re-derived from a
 *  row: the host computes that partition once, every pip in the section paints
 *  from it, and a header counting a second opinion is exactly the disagreement
 *  — a `2 working` over three moving pips — the shared attention frame exists to
 *  prevent. The dock's ranking buckets are an ORDER, and order is not colour. */
export function fleetView<R extends FleetRowFacts>(
  ranked: readonly R[],
  askingIds: readonly TerminalId[],
  workingIds: readonly TerminalId[],
): FleetView<R> {
  const asking = new Set<TerminalId>(askingIds);
  const busy = new Set<TerminalId>(workingIds);
  const needsYou: TerminalId[] = [];
  let working = 0;
  for (const row of ranked) {
    if (asking.has(row.id)) needsYou.push(row.id);
    if (busy.has(row.id)) working += 1;
  }
  return { rows: ranked, needsYou, working };
}

/** The fleet's ids that still have a terminal record, in the order padi listed
 *  them. The guard is the removal race made explicit: a kill lands on the
 *  terminals collection before the orchestrator cell drops the id, so for a tick
 *  the fleet names a terminal nothing can draw. */
export function liveFleetIds(
  fleet: readonly TerminalId[],
  hasRecord: (id: TerminalId) => boolean,
): readonly TerminalId[] {
  return fleet.filter(hasRecord);
}
