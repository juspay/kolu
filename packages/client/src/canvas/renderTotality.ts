/** The totality invariant: every live terminal has exactly one render site.
 *
 *  This is the guard that makes #2059's whole CLASS loud instead of invisible.
 *  That bug was not a missing case — it was a missing *complaint*. Visibility
 *  was derived by filtering (`!parentId` → tile, one level of children per
 *  tile), and a record matching no rule simply fell out of every list. Nothing
 *  threw, nothing logged: the terminal ran perfectly, answered MCP calls, and
 *  could not be seen. A filter has no failure mode, so the absence was
 *  indistinguishable from correctness.
 *
 *  The tree-is-the-tiling design removes the filter (placement is a total
 *  function of the tree), and this check proves the removal held: it compares
 *  the roster against what the canvas actually rendered and reports anyone
 *  missing. Reported LOUDLY — a live terminal nobody can see is a defect, never
 *  a UI state to tune around, and the repo's fail-fast rule says such a thing
 *  must surface rather than degrade quietly.
 *
 *  It deliberately does NOT throw. Throwing inside the canvas's reactive graph
 *  would blank the whole workspace over a bookkeeping slip — trading an
 *  invisible terminal for an invisible everything — so it reports instead, once
 *  per offending id. */

import type { TileId } from "../tile/tileContent";

/** Ids already reported, so a re-render doesn't spam the console with a
 *  standing violation. Module scope is deliberate and host-INDEPENDENT by
 *  design: this is a developer-facing defect log, not per-host state. */
const reported = new Set<TileId>();

export interface TotalityInput {
  /** Every terminal that should be visible — live, non-parked, arrived. */
  expected: readonly TileId[];
  /** Every id the canvas produced a box for this frame. */
  rendered: ReadonlySet<TileId>;
}

/** Return the ids that are alive but have no render site. Pure — the caller
 *  decides what to do with them (see `assertRenderTotality`). */
export function missingRenderSites(input: TotalityInput): TileId[] {
  return input.expected.filter((id) => !input.rendered.has(id));
}

/** Check the invariant and report any violation. Returns the offending ids so
 *  a test can assert on them without reading the console. */
export function assertRenderTotality(input: TotalityInput): TileId[] {
  const missing = missingRenderSites(input);
  for (const id of missing) {
    if (reported.has(id)) continue;
    reported.add(id);
    console.error(
      `canvas: terminal ${id} is live but has no place on the canvas. ` +
        `Every live terminal must render as a tile — this is the #2059 class ` +
        `of defect (a terminal that exists, works, and cannot be seen).`,
    );
  }
  // A terminal that came back (or departed) may legitimately violate again
  // later; only keep the suppression for ids still missing right now.
  for (const id of reported) {
    if (!missing.includes(id)) reported.delete(id);
  }
  return missing;
}
