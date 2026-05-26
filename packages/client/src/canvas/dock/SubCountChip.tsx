/** Sub-terminal count chip — shared between the desktop dock body
 *  variants and the mobile dock row. Surfaces `subCount > 0` on the
 *  row's title bar so a glance at the dock alone reveals which
 *  terminals have splits open, without diving into the canvas. Uses
 *  the same `SplitToggleIcon` + numeric vocabulary the tile header
 *  already uses (`TileTitleActions`), so the symbol reads consistently
 *  across surfaces. Active rows get a translucent-white treatment to
 *  survive the accent flood; inactive rows mix `currentColor` so the
 *  chip inherits the row's text tone.
 *
 *  `testId` is required (not optional with a default) so each call
 *  site is testable by a stable id. Both desktop and mobile dock rows
 *  render this via the shared `RowPips` `SubCountCell`, which passes
 *  `testId="dock-sub-count"`. */

import type { Component } from "solid-js";
import { SplitToggleIcon } from "../../ui/Icons";

export const SubCountChip: Component<{
  count: number;
  active: boolean;
  testId: string;
}> = (props) => (
  <span
    data-testid={props.testId}
    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[0.7rem] font-semibold tabular-nums leading-none shrink-0"
    style={{
      "background-color": props.active
        ? "rgba(255, 255, 255, 0.18)"
        : "color-mix(in oklch, currentColor 10%, transparent)",
      border: props.active
        ? "1px solid rgba(255, 255, 255, 0.32)"
        : "1px solid color-mix(in oklch, currentColor 22%, transparent)",
    }}
    title={`${props.count} sub-terminal${props.count === 1 ? "" : "s"}`}
  >
    <SplitToggleIcon class="w-3 h-3" />
    <span>{props.count}</span>
  </span>
);
