/** Activity-window overflow disclosure — the "N hidden by <window>
 *  — show all" strip rendered at the bottom of the dock when the
 *  filter has parked rows.
 *
 *  Owns one volatility axis: how the dock surfaces *and offers an
 *  escape from* rows the activity window has hidden. Consumed by
 *  both the desktop `Dock` and the mobile `MobileDockDrawer`; the
 *  `compact` prop selects mobile sizing (taller tap target, no
 *  desktop hover/focus styling that doesn't apply on touch).
 *
 *  Clicking sets `activityWindow("all")` — the same shared signal
 *  the minimap and other consumers read, so the relaxation is one
 *  persistent choice, not a dock-local override. */

import { type Component, Show } from "solid-js";
import {
  activityWindow,
  setActivityWindow,
  windowOption,
} from "../../terminal/activityWindow";

export const HiddenFooter: Component<{
  parkedCount: number;
  compact?: boolean;
  testId?: string;
}> = (props) => (
  <Show when={props.parkedCount > 0 && activityWindow() !== "all"}>
    <button
      type="button"
      data-testid={props.testId ?? "dock-hidden-footer"}
      onClick={() => setActivityWindow("all")}
      classList={{
        // Common: bordered top edge, neutral text, left-aligned content.
        "flex items-center gap-1.5 border-t border-edge/40 text-fg-3 text-left cursor-pointer": true,
        // Touch (mobile drawer): larger vertical padding, slightly
        // bigger type so the row clears 44 px tap target.
        "px-3 py-3 text-[0.75rem] active:bg-surface-2": props.compact === true,
        // Pointer (desktop): tight padding, hover + focus affordances.
        "px-3 py-2 text-[0.65rem] hover:text-fg hover:bg-surface-2/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40":
          props.compact !== true,
      }}
      title="Show every terminal, regardless of activity window"
    >
      <span class="tabular-nums">{props.parkedCount}</span>
      <span class="truncate">
        hidden by{" "}
        <span class="font-mono">{windowOption(activityWindow()).short}</span>{" "}
        window
      </span>
      <span class="ml-auto text-accent shrink-0">show all</span>
    </button>
  </Show>
);
