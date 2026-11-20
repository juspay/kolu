import type { Component } from "solid-js";
import { setShowSleeping, showSleeping } from "../terminal/showSleeping";
import { FILTER_CHIP_BASE, filterChipAccent } from "./filterChip";
import { MoonIcon } from "./Icons";

export const SleepingToggle: Component<{
  /** How many sleeping terminals the dock holds. */
  count: number;
  /** Per-surface namespace for the toggle's `data-testid`; e2e selectors
   *  hard-code these. */
  testIdPrefix: "dock-sleeping" | "mobile-dock-sleeping";
  class?: string;
}> = (props) => {
  const hidden = () => !showSleeping();
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
      <MoonIcon class="w-3.5 h-3.5" />
      <span aria-hidden="true">{props.count}</span>
    </button>
  );
};
