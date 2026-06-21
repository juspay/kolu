/** Sub-terminal count chip — shared between the desktop dock body
 *  variants and the mobile dock row. Surfaces `subCount > 0` on the
 *  row's title bar so a glance at the dock alone reveals which
 *  terminals have splits open, without diving into the canvas. Uses
 *  the same `SplitToggleIcon` + numeric vocabulary the tile header
 *  already uses (`TileTitleActions`), so the symbol reads consistently
 *  across surfaces. Rendered as a bare icon + count in the muted
 *  `fg-3` tone — the same treatment as the sibling `PrPip` — so it
 *  reads as one of the row's quiet presence pips rather than a framed
 *  badge that fights the branch label for attention.
 *
 *  `testId` is required (not optional with a default) so each call
 *  site is testable by a stable id. Both desktop and mobile dock rows
 *  render this via the shared `RowPips` `SubCountCell`, which passes
 *  `testId="dock-sub-count"`. */

import type { Component } from "solid-js";
import { SplitToggleIcon } from "../../ui/Icons";

export const SubCountChip: Component<{
  count: number;
  testId: string;
}> = (props) => (
  <span
    data-testid={props.testId}
    class="inline-flex items-center gap-1 font-mono text-[0.7rem] tabular-nums leading-none shrink-0 text-fg-3"
    title={`${props.count} sub-terminal${props.count === 1 ? "" : "s"}`}
  >
    <SplitToggleIcon class="w-3 h-3" />
    <span>{props.count}</span>
  </span>
);
