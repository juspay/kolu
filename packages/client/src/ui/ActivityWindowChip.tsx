import { type Component, createSignal } from "solid-js";
import { WINDOW_OPTIONS, windowOption } from "../terminal/activityWindow";
import {
  activityWindow,
  setActivityWindow,
} from "../terminal/activityWindowFilter";
import { FILTER_CHIP_BASE, filterChipAccent } from "./filterChip";
import { OptionMenu } from "./OptionMenu";
import type { AnchorSide } from "./useAnchoredPopover";

export const ActivityWindowChip: Component<{
  /** Where the popover opens relative to the trigger. */
  anchor: AnchorSide;
  /** Drives `data-testid` on the trigger (`<prefix>-trigger`) and each option
   *  (`<prefix>-option-<value>`); e2e selectors hard-code these prefixes. */
  testIdPrefix: "dock-window" | "minimap-window" | "mobile-dock-window";
  class?: string;
}> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  const current = () => windowOption(activityWindow());
  return (
    <>
      <button
        type="button"
        ref={triggerEl}
        data-testid={`${props.testIdPrefix}-trigger`}
        data-window={activityWindow()}
        data-enabled={activityWindow() !== "all" ? "" : undefined}
        class={`${FILTER_CHIP_BASE} ${props.class ?? ""}`}
        classList={filterChipAccent(activityWindow() !== "all")}
        aria-label={`Activity window: ${current().label}`}
        title={`Activity window: ${current().label} — click to change`}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        {current().short}
      </button>
      <OptionMenu
        triggerRef={() => triggerEl}
        open={menuOpen}
        onDismiss={() => setMenuOpen(false)}
        anchor={props.anchor}
        options={WINDOW_OPTIONS}
        value={activityWindow()}
        onSelect={setActivityWindow}
        testIdPrefix={props.testIdPrefix}
      />
    </>
  );
};
