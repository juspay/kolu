/** Dock recency cell — renders a terminal's "Xs ago" (`formatTimeAgo`).
 *
 *  The live-output signal no longer rides here: it leads the row as the
 *  `ActivityPip` column (left of the `StatePip`), so the timestamp stays
 *  put and the two axes — "when last" (right) and "moving now" (left) —
 *  read on separate edges instead of fighting for one slot.
 *
 *  The fixed `w-[8ch]` reserves the WIDEST `formatTimeAgo` string ("just now" =
 *  8ch, also covering "59m ago" / "23h ago" / "99d ago"), so a changing label
 *  never collapses the cell's track or overflows into the adjacent column;
 *  right-aligned so the timestamp lands in one column across rows. Shared by
 *  the desktop dock row (`DockRow`) and the touch drawer row (`DockListRow`)
 *  so that width contract — the load-bearing no-reflow invariant — lives in
 *  exactly one place; the two only differ in font size, passed as `textSize`. */

import type { Component } from "solid-js";
import { formatTimeAgo } from "../../terminal/staleness";

const RecencyCell: Component<{
  lastActivityAt: number;
  /** Tailwind text-size token — the only thing the desktop and touch rows
   *  differ by (e.g. `text-[0.6rem]` vs `text-[0.65rem]`). */
  textSize: string;
}> = (props) => (
  <span
    class={`inline-flex justify-end w-[8ch] font-mono tabular-nums text-fg-3 ${props.textSize}`}
  >
    {formatTimeAgo(props.lastActivityAt)}
  </span>
);

export default RecencyCell;
