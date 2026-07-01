/** Dock filter strip — the single bottom-of-dock home for the dock's two
 *  filters, framed as one group so they read as siblings rather than two
 *  unrelated controls:
 *
 *    - the **activity window** chip (`All` / `4h` / … `48h`) hides rows by
 *      *staleness*,
 *    - the **☾ sleeping** chip hides rows by *deliberate dormancy*.
 *
 *  Both are rendered with the SAME chip chrome (`filterChipClass`) and the
 *  SAME "accent when actively hiding, neutral in its permissive default"
 *  grammar, behind a `Filters` label — so the strip reads as "here are the
 *  dock's filters" at a glance. A single trailing `N hidden · show all`
 *  reports how many rows *both* filters are hiding together and clears
 *  them in one click.
 *
 *  Sits at the bottom of the dock body (desktop) and the mobile drawer;
 *  `compact` selects touch sizing, and `rail` selects the collapsed-dock
 *  layout — chip-only stacked vertically, since the 44px rail can't hold
 *  the `Filters` label or the sentence.
 *
 *  Gated on `tree.hasContent` by the dock, so it never renders at true
 *  zero. The ☾ chip and the `N hidden · show all` reset each render only
 *  when they'd actually do something (there's a sleeping row to act on /
 *  a filter is hiding rows), the same way the window's old "show all"
 *  only appeared when it would relax something. */

import { batch, type Component, createMemo, Show } from "solid-js";
import { setActivityWindow } from "../../terminal/activityWindow";
import { setShowSleeping } from "../../terminal/showSleeping";
import { ActivityWindowChip } from "../../ui/ActivityWindowChip";
import { DOCK_CARDS_GUTTER_CLASS } from "../../ui/chromeSpacing";
import { SleepingToggle } from "../../ui/SleepingToggle";

/** Default testid for the footer strip's root element. The footer's
 *  identity is one concept, so the fallback literal lives here once and
 *  both layouts (rail + cards) reference it — neither branch can drift. */
const DOCK_HIDDEN_FOOTER_TESTID = "dock-hidden-footer";

/** Shared chip shell — the radius + hover both filters wear in every
 *  layout, so it's written once here and can't drift between the sizing
 *  tiers below (keeping the two chips visually identical is the whole
 *  point of the `Filters` group). Only the sizing tail differs per tier. */
const CHIP_SHELL = "rounded-md hover:bg-surface-2/70";

/** The one chip chrome BOTH filters wear — size, shape, radius, hover —
 *  so the activity-window chip and the ☾ chip are visually identical and
 *  can't drift apart. Only the sizing tier differs (touch vs pointer);
 *  each chip bakes in its own accent-vs-neutral colour. */
function filterChipClass(compact: boolean | undefined): string {
  return compact === true
    ? `${CHIP_SHELL} h-6 min-w-6 px-1.5 text-[0.75rem]`
    : `${CHIP_SHELL} h-5 min-w-5 px-1 text-[0.65rem]`;
}

/** Rail chip chrome — one class for both stacked chips in the 44px rail. */
const RAIL_CHIP_CLASS = `${CHIP_SHELL} h-5 min-w-5 px-1 text-[0.6rem] leading-none`;

/** The ☾ chip's testid prefix tracks the window chip's surface — both
 *  share the footer, so one derivation keeps the desktop/mobile split in
 *  lockstep and a caller can't wire the two controls to different
 *  surfaces by accident. */
function sleepingPrefix(
  chip: "dock-window" | "mobile-dock-window" | undefined,
): "dock-sleeping" | "mobile-dock-sleeping" {
  return chip === "mobile-dock-window"
    ? "mobile-dock-sleeping"
    : "dock-sleeping";
}

export const HiddenFooter: Component<{
  /** How many rows BOTH filters are hiding right now, computed by
   *  `buildDockTree` (the receptacle that owns the filtering). The footer
   *  reports this answer rather than re-applying the filter rule itself. */
  hiddenCount: number;
  /** Fresh sleeping rows in the dock (shown or hidden by the ☾ chip).
   *  The ☾ chip only renders when this is > 0 — there's nothing to show
   *  or hide otherwise. */
  sleepingCount: number;
  compact?: boolean;
  /** Rail (collapsed dock) layout. The 44px rail has no room for the
   *  `Filters` label or the `N hidden` sentence — they clip under the
   *  dock's `overflow-hidden`. Instead, collapse to the two chips stacked
   *  vertically (their own labels + tooltips carry the meaning), with the
   *  combined hidden-count reset button stacked above only when a filter
   *  is actually hiding rows. */
  rail?: boolean;
  testId?: string;
  /** Per-surface namespace for the embedded chips' testids. Distinct
   *  desktop/mobile prefixes keep simultaneous renders (the rare case
   *  where both the desktop dock and the mobile drawer are mounted) from
   *  colliding on `dock-window-trigger` / `dock-sleeping-toggle`. */
  chipTestIdPrefix?: "dock-window" | "mobile-dock-window";
}> = (props) => {
  // `props.hiddenCount` is the answer the tree already computed — what
  // BOTH filters are hiding right now. `showReset` gates the single
  // `show all`, which relaxes BOTH filters — the only way to truly reveal
  // every terminal, since leaving the window at `24h` would keep parked
  // rows hidden.
  const showReset = createMemo(() => props.hiddenCount > 0);
  // Both writes feed the one `useDockOrder` memo, so batch them into a
  // single dock-tree recompute instead of two.
  const resetAll = () =>
    batch(() => {
      setActivityWindow("all");
      setShowSleeping(true);
    });
  // `props.rail` flips when the dock toggles rail ↔ cards while this
  // footer instance stays mounted (the parent never remounts it). A
  // bare `if (props.rail)` would read the prop once at create time and
  // freeze the layout, so the rail/cards choice has to live inside the
  // returned tree where Solid can re-run it. `<Show>` does exactly that.
  return (
    <Show
      when={props.rail}
      fallback={
        <CardsLayout
          sleepingCount={props.sleepingCount}
          compact={props.compact}
          testId={props.testId}
          chipTestIdPrefix={props.chipTestIdPrefix}
          hiddenCount={props.hiddenCount}
          showReset={showReset}
          resetAll={resetAll}
        />
      }
    >
      <div
        data-testid={props.testId ?? DOCK_HIDDEN_FOOTER_TESTID}
        data-layout="rail"
        class="flex flex-col items-center gap-1 border-t border-edge/40 py-2 text-fg-3"
      >
        {/* Combined recovery affordance: when a filter is hiding rows the
         *  count doubles as the one-click "show all" the cards footer
         *  spells out — there's no room for the label in 44px, so the
         *  click + accessible name carry it. */}
        <Show when={showReset()}>
          <button
            type="button"
            data-testid="dock-hidden-show-all"
            onClick={resetAll}
            class="tabular-nums text-[0.6rem] leading-none text-accent cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={`${props.hiddenCount} terminals hidden by dock filters — show all`}
            title={`${props.hiddenCount} hidden by filters — show all`}
          >
            <span aria-hidden="true">{props.hiddenCount}</span>
          </button>
        </Show>
        {/* Two matched chips, stacked: the activity window then the ☾
         *  sleeping filter (rendered only when there's a sleeper to act
         *  on). Same chip class → identical chrome in the narrow rail. */}
        <ActivityWindowChip
          anchor="top-start"
          testIdPrefix={props.chipTestIdPrefix ?? "dock-window"}
          class={RAIL_CHIP_CLASS}
        />
        <Show when={props.sleepingCount > 0}>
          <SleepingToggle
            count={props.sleepingCount}
            testIdPrefix={sleepingPrefix(props.chipTestIdPrefix)}
            class={RAIL_CHIP_CLASS}
          />
        </Show>
      </div>
    </Show>
  );
};

/** Cards / mobile layout — a `Filters` label framing the two matched
 *  chips, with a trailing `N hidden · show all` reset. Split out so the
 *  rail/cards choice in `HiddenFooter` is a single reactive `<Show>`
 *  rather than a create-time branch that freezes when the dock mode
 *  toggles. */
const CardsLayout: Component<{
  sleepingCount: number;
  compact?: boolean;
  testId?: string;
  chipTestIdPrefix?: "dock-window" | "mobile-dock-window";
  /** Combined hidden-row count from the tree (props stay reactive, so the
   *  child reads it directly). `showReset`/`resetAll` are shared
   *  reactive/handler nodes hoisted from HiddenFooter. */
  hiddenCount: number;
  showReset: () => boolean;
  resetAll: () => void;
}> = (props) => {
  const chipClass = () => filterChipClass(props.compact);
  return (
    <div
      data-testid={props.testId ?? DOCK_HIDDEN_FOOTER_TESTID}
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
      {/* The framing label — turns two lone controls into an obvious
       *  "these are the dock's filters" group. */}
      <span class="uppercase tracking-[0.14em] text-[0.85em] text-fg-3 select-none">
        Filters
      </span>
      <ActivityWindowChip
        anchor="top-start"
        testIdPrefix={props.chipTestIdPrefix ?? "dock-window"}
        class={chipClass()}
      />
      <Show when={props.sleepingCount > 0}>
        <SleepingToggle
          count={props.sleepingCount}
          testIdPrefix={sleepingPrefix(props.chipTestIdPrefix)}
          class={chipClass()}
        />
      </Show>
      {/* One combined disclosure + reset for BOTH filters, trailing-edge
       *  aligned — renders only when something is actually hidden. */}
      <Show when={props.showReset()}>
        <div class="ml-auto flex items-center gap-1.5 tabular-nums shrink-0">
          <span>{props.hiddenCount} hidden</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            data-testid="dock-hidden-show-all"
            onClick={props.resetAll}
            class="text-accent cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
            title="Show every terminal — clears the activity window and un-hides sleeping"
          >
            show all
          </button>
        </div>
      </Show>
    </div>
  );
};
