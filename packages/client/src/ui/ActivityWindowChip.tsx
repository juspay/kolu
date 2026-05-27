/** ActivityWindowChip — the shared trigger button + popover that lets
 *  the user pick an activity-window value (`All` / `4h` / `12h` / `24h`
 *  / `48h`). Both the dock's footer-hosted picker and the canvas
 *  minimap's zoom-bar picker reach for this — same vocabulary, same
 *  signal, same `OptionMenu`; only the chip's surrounding chrome
 *  (sizing, border) and the popover anchor differ.
 *
 *  The chip styles itself minimally — the caller passes `class` to
 *  decide how the chip fits its surrounding strip (the dock footer
 *  inlines it into a sentence; the minimap docks it to the right edge
 *  of the zoom bar with a left border). The current accent vs. neutral
 *  colouring is baked in here because the meaning ("filter active" vs
 *  "all") is the same wherever the chip lives. */

import { type Component, createSignal } from "solid-js";
import {
  activityWindow,
  setActivityWindow,
  WINDOW_OPTIONS,
  windowOption,
} from "../terminal/activityWindow";
import type { AnchorSide } from "./useAnchoredPopover";
import { OptionMenu } from "./OptionMenu";

export const ActivityWindowChip: Component<{
  /** Where the popover should open relative to the trigger. Dock footer
   *  uses `"top-start"` (panel opens upward, left-aligned with the
   *  trigger); minimap uses `"top-end"` (upward, right-aligned). */
  anchor: AnchorSide;
  /** Drives `data-testid` on both the trigger button (`<prefix>-trigger`)
   *  and each option (`<prefix>-option-<value>`). Keep stable per
   *  surface so e2e selectors continue to resolve. */
  testIdPrefix: string;
  /** Tailwind classes for the trigger's own chrome — size, padding,
   *  border. Colour state (accent when filtered, neutral when `all`)
   *  and the shared hover/focus/font are baked in below. */
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
        class={`inline-flex items-center justify-center font-mono tabular-nums cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${props.class ?? ""}`}
        classList={{
          "text-fg-3 hover:text-fg": activityWindow() === "all",
          "text-accent": activityWindow() !== "all",
        }}
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
