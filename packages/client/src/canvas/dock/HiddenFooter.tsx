/** Activity-window footer strip — the single bottom-of-dock home for
 *  both the activity-window picker and the "what is the window
 *  hiding right now?" disclosure. Sits at the bottom of the dock body
 *  (desktop) and the mobile drawer; the `compact` prop selects touch
 *  sizing (taller, slightly larger type).
 *
 *  Always rendered. When nothing is parked, the strip honestly reads
 *  "0 hidden by 4h window" — the disclosure's empty state, not invented
 *  copy. The picker chip is inline inside the sentence, so the user
 *  reaches the control next to where its effect is visible (no
 *  ping-pong between dock header and dock footer).
 *
 *  "show all" is a fast-relax shortcut and only renders when it would
 *  actually do something (`parkedCount > 0 && activityWindow !== "all"`);
 *  in every other state the picker chip alone is the way to widen the
 *  window. */

import { type Component, createMemo, Show } from "solid-js";
import { ActivityWindowChip } from "../../ui/ActivityWindowChip";
import { DOCK_CARDS_GUTTER_CLASS } from "../../ui/chromeSpacing";
import {
  activityWindow,
  setActivityWindow,
} from "../../terminal/activityWindow";

export const HiddenFooter: Component<{
  parkedCount: number;
  compact?: boolean;
  testId?: string;
  /** Per-surface namespace for the embedded `ActivityWindowChip`'s
   *  testids. Distinct desktop/mobile prefixes keep simultaneous renders
   *  (the rare case where both the desktop dock and the mobile drawer
   *  are mounted) from colliding on `dock-window-trigger`. */
  chipTestIdPrefix?: "dock-window" | "mobile-dock-window";
}> = (props) => {
  // When `activityWindow === "all"` the threshold is null and no row can
  // be parked — so `parkedCount > 0` is structurally impossible there.
  // That collapses three states into two: a filter is active (show the
  // "N hidden by … window" sentence) or it isn't (label the chip plainly
  // so the strip doesn't read "0 hidden by All window").
  const filterActive = createMemo(() => activityWindow() !== "all");
  const showRelax = createMemo(() => props.parkedCount > 0 && filterActive());
  return (
    <div
      data-testid={props.testId ?? "dock-hidden-footer"}
      classList={{
        // Common: bordered top edge, neutral text, left-aligned content.
        "flex items-center gap-1.5 border-t border-edge/40 text-fg-3 text-left": true,
        // Touch (mobile drawer): larger vertical padding, slightly bigger
        // type so the strip clears 44px tap target.
        "px-3 py-3 text-[0.75rem]": props.compact === true,
        // Pointer (desktop): right padding tracks the dock cards' row
        // gutter so "show all" sits in the same column as the time
        // labels above it.
        [`pl-3 ${DOCK_CARDS_GUTTER_CLASS} py-2 text-[0.65rem]`]:
          props.compact !== true,
      }}
    >
      <Show when={filterActive()} fallback={<span>Activity window</span>}>
        <span class="tabular-nums">{props.parkedCount}</span>
        <span>hidden by</span>
      </Show>
      <ActivityWindowChip
        anchor="top-start"
        testIdPrefix={props.chipTestIdPrefix ?? "dock-window"}
        class={`rounded-md hover:bg-surface-2/70 ${
          props.compact === true
            ? "h-6 min-w-6 px-1.5 text-[0.75rem]"
            : "h-5 min-w-5 px-1 text-[0.65rem]"
        }`}
      />
      <Show when={filterActive()}>
        <span>window</span>
      </Show>
      <Show when={showRelax()}>
        <button
          type="button"
          data-testid="dock-hidden-show-all"
          onClick={() => setActivityWindow("all")}
          class="ml-auto text-accent shrink-0 cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          title="Show every terminal, regardless of activity window"
        >
          show all
        </button>
      </Show>
    </div>
  );
};
