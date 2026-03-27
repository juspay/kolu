/** Settings popover — toggleable settings anchored to a trigger button. */

import { type Component, Show } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";

const SettingsPopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  randomTheme: boolean;
  onRandomThemeChange: (on: boolean) => void;
}> = (props) => {
  let panelRef: HTMLDivElement | undefined;

  // Close on click outside
  makeEventListener(document, "mousedown", (e) => {
    if (props.open && panelRef && !panelRef.contains(e.target as Node)) {
      props.onOpenChange(false);
    }
  });

  // Close on Escape
  makeEventListener(document, "keydown", (e) => {
    if (props.open && e.key === "Escape") {
      props.onOpenChange(false);
    }
  });

  return (
    <Show when={props.open}>
      <div
        ref={panelRef}
        data-testid="settings-popover"
        class="absolute right-0 top-full mt-1 z-50 bg-surface-1 border border-edge-bright rounded-lg shadow-lg p-3 min-w-[200px]"
      >
        <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
          <span class="text-fg-2">Random theme</span>
          <button
            data-testid="random-theme-toggle"
            data-enabled={props.randomTheme ? "" : undefined}
            class="relative w-8 h-4 rounded-full transition-colors"
            classList={{
              "bg-accent": props.randomTheme,
              "bg-surface-3": !props.randomTheme,
            }}
            onClick={() => props.onRandomThemeChange(!props.randomTheme)}
          >
            <span
              class="absolute top-0.5 w-3 h-3 rounded-full bg-fg transition-transform"
              classList={{
                "left-[18px]": props.randomTheme,
                "left-0.5": !props.randomTheme,
              }}
            />
          </button>
        </label>
      </div>
    </Show>
  );
};

export default SettingsPopover;
