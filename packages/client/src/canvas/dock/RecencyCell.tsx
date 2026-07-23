/** Dock recency cell — renders a terminal's "Xs ago" (`formatTimeAgo`).
 *
 *  The timestamp is the row's `rowRecencyAt` — `lastActivityAt` for a live
 *  tile, `sleptAt` for a sleeping one — the SAME value the activity window
 *  keys on, so the age a row shows is the age that decides whether the window
 *  hides it.
 *
 *  Active rows hide the label: effectively active terminals (same predicate as
 *  `pipIsActive` — do not re-derive the formula here) are "just now" by
 *  definition, so the text is noise. The fixed `w-[8ch]` still reserves the
 *  column so rows do not jump when the cell appears on quiet.
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
  /** The row's recency timestamp (`rowRecencyAt`) — `lastActivityAt` for a
   *  live tile, `sleptAt` for a sleeping one. The age the window acts on.
   *  `null` — never-active — renders as the empty string
   *  (`formatTimeAgo`'s honest "nothing to report"). */
  recencyAt: number | null;
  /** Tailwind text-size token — the only thing the desktop and touch rows
   *  differ by (e.g. `text-[0.6rem]` vs `text-[0.65rem]`). */
  textSize: string;
  /** Hide the label while the terminal is effectively active (`pipIsActive`).
   *  Column width is still reserved. */
  hidden?: boolean;
}> = (props) => (
  <span
    class={`inline-flex justify-end w-[8ch] font-mono tabular-nums text-fg-3 ${props.textSize}`}
  >
    {props.hidden ? "" : formatTimeAgo(props.recencyAt)}
  </span>
);

export default RecencyCell;
