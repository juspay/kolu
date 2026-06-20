/** Dock recency cell — renders a terminal's "Xs ago" (`formatTimeAgo`) but
 *  swaps in the `LiveActivityDot` while that terminal is streaming output.
 *
 *  The fixed `w-[8ch]` reserves the WIDEST `formatTimeAgo` string ("just now" =
 *  8ch, also covering "59m ago" / "23h ago" / "99d ago"), so neither the dot
 *  swap nor a changing label collapses the cell's track or overflows into the
 *  adjacent column; right-aligned so the dot/timestamp lands in one column
 *  across rows. Shared by the desktop dock row (`DockRow`) and the touch
 *  drawer row (`DockListRow`) so that width contract — the load-bearing
 *  no-reflow invariant — lives in exactly one place; the two only differ in
 *  font size, passed as `textSize`. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import LiveActivityDot from "../../terminal/LiveActivityDot";
import { formatTimeAgo } from "../../terminal/staleness";
import { useTerminalActivity } from "../../terminal/useTerminalActivity";

const RecencyCell: Component<{
  id: TerminalId;
  lastActivityAt: number;
  /** Tailwind text-size token — the only thing the desktop and touch rows
   *  differ by (e.g. `text-[0.6rem]` vs `text-[0.65rem]`). */
  textSize: string;
}> = (props) => {
  const activity = useTerminalActivity();
  return (
    <span
      class={`inline-flex justify-end w-[8ch] font-mono tabular-nums text-fg-3 ${props.textSize}`}
    >
      <Show
        when={activity.isLive(props.id)}
        fallback={formatTimeAgo(props.lastActivityAt)}
      >
        <LiveActivityDot />
      </Show>
    </span>
  );
};

export default RecencyCell;
