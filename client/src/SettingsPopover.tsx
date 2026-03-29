/** Settings popover — toggleable settings anchored to a trigger button. */

import { type Component, Show, For } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import Toggle from "./Toggle";
import type { ColorScheme } from "./useColorScheme";

const SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const SettingsPopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  randomTheme: boolean;
  onRandomThemeChange: (on: boolean) => void;
  scrollLock: boolean;
  onScrollLockChange: (on: boolean) => void;
  colorScheme: ColorScheme;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  startupTips: boolean;
  onStartupTipsChange: (on: boolean) => void;
  activityAlerts: boolean;
  onActivityAlertsChange: (on: boolean) => void;
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
        class="absolute right-0 top-full mt-1 z-50 bg-surface-1 border border-edge-bright rounded-lg shadow-lg p-3 min-w-[200px] space-y-3"
      >
        {/* Color scheme */}
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="text-fg-2">Theme</span>
          <div
            data-testid="color-scheme-toggle"
            class="flex rounded-md overflow-hidden border border-edge"
          >
            <For each={SCHEME_OPTIONS}>
              {(opt) => (
                <button
                  data-testid={`color-scheme-${opt.value}`}
                  class="px-2 py-0.5 text-xs transition-colors cursor-pointer"
                  classList={{
                    "bg-accent text-surface-0": props.colorScheme === opt.value,
                    "bg-surface-2 text-fg-2 hover:text-fg":
                      props.colorScheme !== opt.value,
                  }}
                  onClick={() => props.onColorSchemeChange(opt.value)}
                >
                  {opt.label}
                </button>
              )}
            </For>
          </div>
        </div>
        {/* Random terminal theme */}
        <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
          <span class="text-fg-2">Random theme</span>
          <Toggle
            testId="random-theme-toggle"
            enabled={props.randomTheme}
            onChange={props.onRandomThemeChange}
          />
        </label>
        {/* Scroll lock */}
        <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
          <span class="text-fg-2">Scroll lock</span>
          <Toggle
            testId="scroll-lock-toggle"
            enabled={props.scrollLock}
            onChange={props.onScrollLockChange}
          />
        </label>
        {/* Activity alerts */}
        <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
          <span class="text-fg-2">Activity alerts</span>
          <Toggle
            testId="activity-alerts-toggle"
            enabled={props.activityAlerts}
            onChange={props.onActivityAlertsChange}
          />
        </label>
        {/* Startup tips */}
        <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
          <span class="text-fg-2">Startup tips</span>
          <Toggle
            testId="startup-tips-toggle"
            enabled={props.startupTips}
            onChange={props.onStartupTipsChange}
          />
        </label>
      </div>
    </Show>
  );
};

export default SettingsPopover;
