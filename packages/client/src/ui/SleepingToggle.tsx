/** SleepingToggle — the dock footer's moon button that shows or hides
 *  sleeping terminals. A sibling to `ActivityWindowChip`: both are
 *  filters over the same dock, so they share the footer strip and the
 *  same colour grammar — accent when a filter is *active* (here: sleeping
 *  rows are hidden), neutral when the dock shows everything.
 *
 *  A boolean toggle, so it's a plain button (no `OptionMenu` popover the
 *  window chip needs for its five values). The caller passes `class` to
 *  size it into the surrounding strip. The moon glyph is the shared
 *  `MoonIcon` — the same crescent the tile Sleep/Wake buttons and the
 *  minimap's hide-parked toggle use, so the "sleeping" concept has one
 *  registered icon everywhere. State reads by colour (accent when hiding),
 *  matching the window chip's grammar; the count sits beside it. */

import type { Component } from "solid-js";
import { setShowSleeping, showSleeping } from "../terminal/showSleeping";
import { FILTER_CHIP_BASE, filterChipAccent } from "./filterChip";
import { MoonIcon } from "./Icons";

export const SleepingToggle: Component<{
  /** How many sleeping terminals the dock holds (shown or hidden). Shown
   *  next to the glyph so the user knows the toggle's stakes — "hide the
   *  3 sleeping ones" vs "bring 3 back". The caller only mounts the toggle
   *  when this is > 0, so it never reads "0". */
  count: number;
  /** Per-surface namespace for the toggle's `data-testid`, mirroring
   *  `ActivityWindowChip`'s prefix contract so simultaneous desktop +
   *  mobile-drawer renders don't collide on `dock-sleeping-toggle`. The
   *  literal union is the contract — e2e selectors hard-code these. */
  testIdPrefix: "dock-sleeping" | "mobile-dock-sleeping";
  /** Tailwind classes for the button's own chrome — size, padding,
   *  border. Colour state is baked in below. */
  class?: string;
}> = (props) => {
  const hidden = () => !showSleeping();
  // Screen-reader / tooltip text names the noun, so pluralize it off the
  // count — "1 sleeping terminal", "3 sleeping terminals".
  const noun = () => (props.count === 1 ? "terminal" : "terminals");
  return (
    <button
      type="button"
      data-testid={`${props.testIdPrefix}-toggle`}
      data-hiding={hidden() ? "" : undefined}
      class={`${FILTER_CHIP_BASE} gap-1 ${props.class ?? ""}`}
      classList={filterChipAccent(hidden())}
      aria-label={
        hidden()
          ? `${props.count} sleeping ${noun()} hidden — show them`
          : `Hide ${props.count} sleeping ${noun()}`
      }
      title={
        hidden()
          ? `${props.count} sleeping hidden — click to show`
          : `${props.count} sleeping shown — click to hide`
      }
      onClick={() => setShowSleeping((prev) => !prev)}
    >
      {/* MoonIcon inherits the button's `currentColor`, so it turns accent
       *  along with the count when the filter is actively hiding. */}
      <MoonIcon class="w-3.5 h-3.5" />
      <span aria-hidden="true">{props.count}</span>
    </button>
  );
};
