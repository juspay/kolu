/** Activity-window footer strip — the single bottom-of-dock home for
 *  both the activity-window picker and the "what is the window
 *  hiding right now?" disclosure. Sits at the bottom of the dock body
 *  (desktop) and the mobile drawer; the `compact` prop selects touch
 *  sizing (taller, slightly larger type), and the `rail` prop selects
 *  the collapsed-dock layout — chip-only, since the 44px rail can't
 *  hold the sentence.
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
import {
  activityWindow,
  setActivityWindow,
} from "../../terminal/activityWindow";
import { ActivityWindowChip } from "../../ui/ActivityWindowChip";
import { DOCK_CARDS_GUTTER_CLASS } from "../../ui/chromeSpacing";

export const HiddenFooter: Component<{
  parkedCount: number;
  compact?: boolean;
  /** Rail (collapsed dock) layout. The 44px rail has no room for the
   *  "N hidden by … window" sentence — it clips under the dock's
   *  `overflow-hidden` and reads as garbled text. Instead, collapse to
   *  just the centered picker chip (its "4h"/"All" label + tooltip
   *  carry the meaning the sentence would spell out), with the parked
   *  count stacked above only when the window is actually hiding rows.
   *  That count doubles as the rail-sized "show all" recovery button —
   *  one click back to the full set, the affordance the cards layout
   *  spells out as a link. */
  rail?: boolean;
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
  // `props.rail` flips when the dock toggles rail ↔ cards while this
  // footer instance stays mounted (the parent never remounts it). A
  // bare `if (props.rail)` would read the prop once at create time and
  // freeze the layout, so the rail/cards choice has to live inside the
  // returned tree where Solid can re-run it. `<Show>` does exactly that.
  return (
    <Show when={props.rail} fallback={<CardsLayout {...props} />}>
      <div
        data-testid={props.testId ?? "dock-hidden-footer"}
        data-layout="rail"
        class="flex flex-col items-center gap-1 border-t border-edge/40 py-2 text-fg-3"
      >
        {/* Rail recovery affordance: when the window is actually hiding
         *  rows, the count doubles as the one-click "show all" escape the
         *  cards footer spells out as a link — there's no room for the
         *  label in 44px, so the click + accessible name carry it. When
         *  nothing is hidden it's a plain count, not interactive. */}
        <Show when={filterActive() && props.parkedCount > 0}>
          <button
            type="button"
            data-testid="dock-hidden-show-all"
            onClick={() => setActivityWindow("all")}
            class="tabular-nums text-[0.6rem] leading-none text-accent cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={`${props.parkedCount} terminals hidden by the activity window — show all`}
            title={`${props.parkedCount} hidden by activity window — show all`}
          >
            <span aria-hidden="true">{props.parkedCount}</span>
          </button>
        </Show>
        <ActivityWindowChip
          anchor="top-start"
          testIdPrefix={props.chipTestIdPrefix ?? "dock-window"}
          class="rounded-md hover:bg-surface-2/70 h-5 min-w-5 px-1 text-[0.65rem]"
        />
      </div>
    </Show>
  );
};

/** Cards / mobile layout — the full "N hidden by [Wh] window — show all"
 *  sentence with the picker chip inline. Split out so the rail/cards
 *  choice in `HiddenFooter` is a single reactive `<Show>` rather than a
 *  create-time branch that freezes when the dock mode toggles. */
const CardsLayout: Component<{
  parkedCount: number;
  compact?: boolean;
  testId?: string;
  chipTestIdPrefix?: "dock-window" | "mobile-dock-window";
}> = (props) => {
  const filterActive = createMemo(() => activityWindow() !== "all");
  const showRelax = createMemo(() => props.parkedCount > 0 && filterActive());
  return (
    <div
      data-testid={props.testId ?? "dock-hidden-footer"}
      data-layout="cards"
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
