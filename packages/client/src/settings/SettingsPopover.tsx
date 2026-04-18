/** Settings popover — reads and writes preferences via usePreferences directly.
 *  Only needs open/close state and trigger ref from the parent. */

import { type Component, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { makeEventListener } from "@solid-primitives/event-listener";
import Toggle from "../ui/Toggle";
import SegmentedControl, {
  type SegmentedControlOption,
} from "../ui/SegmentedControl";
import { usePreferences } from "./usePreferences";
import { useColorScheme, type ColorScheme } from "./useColorScheme";
import type { Preferences } from "kolu-common";

const SCHEME_OPTIONS: readonly SegmentedControlOption<ColorScheme>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** WebGL = system chooses per tile (WebGL on focused, DOM on others).
 *  DOM = force DOM everywhere; no font shift on focus swap. */
const RENDERER_OPTIONS: readonly SegmentedControlOption<
  Preferences["terminalRenderer"]
>[] = [
  { value: "auto", label: "WebGL" },
  { value: "dom", label: "DOM" },
];

const SettingsPopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: HTMLElement;
}> = (props) => {
  const { preferences, updatePreferences } = usePreferences();
  const { colorScheme, setColorScheme } = useColorScheme();

  let panelRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ top: 0, right: 0 });

  // Recompute position each time popover opens
  const updatePos = () => {
    if (!props.triggerRef) return;
    const rect = props.triggerRef.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  // Close on click outside (ignore clicks on the trigger itself)
  makeEventListener(document, "mousedown", (e) => {
    if (
      props.open &&
      panelRef &&
      !panelRef.contains(e.target as Node) &&
      !props.triggerRef?.contains(e.target as Node)
    ) {
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
      <Portal>
        <div
          ref={(el) => {
            panelRef = el;
            updatePos();
          }}
          data-testid="settings-popover"
          class="fixed z-50 bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-3 min-w-[200px] space-y-3"
          style={{
            top: `${pos().top}px`,
            right: `${pos().right}px`,
            "background-color": "var(--color-surface-1)",
          }}
        >
          {/* Color scheme */}
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-fg-2">Theme</span>
            <SegmentedControl
              options={SCHEME_OPTIONS}
              value={colorScheme()}
              onChange={setColorScheme}
              testIdPrefix="color-scheme"
            />
          </div>
          {/* Shuffle theme — auto-pick a perceptually-distinct background
           *  for each new terminal so the sidebar at rest looks variegated
           *  instead of a sea of look-alikes. */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Shuffle theme</span>
            <Toggle
              testId="shuffle-theme-toggle"
              enabled={preferences().shuffleTheme}
              onChange={(on) => updatePreferences({ shuffleTheme: on })}
            />
          </label>
          {/* Scroll lock */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Scroll lock</span>
            <Toggle
              testId="scroll-lock-toggle"
              enabled={preferences().scrollLock}
              onChange={(on) => updatePreferences({ scrollLock: on })}
            />
          </label>
          {/* Activity alerts */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Activity alerts</span>
            <Toggle
              testId="activity-alerts-toggle"
              enabled={preferences().activityAlerts}
              onChange={(on) => updatePreferences({ activityAlerts: on })}
            />
          </label>
          {/* Terminal renderer — WebGL (focused tile) vs DOM everywhere */}
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-fg-2">Renderer</span>
            <SegmentedControl
              options={RENDERER_OPTIONS}
              value={preferences().terminalRenderer}
              onChange={(v) => updatePreferences({ terminalRenderer: v })}
              testIdPrefix="terminal-renderer"
            />
          </div>
          {/* Startup tips */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Startup tips</span>
            <Toggle
              testId="startup-tips-toggle"
              enabled={preferences().startupTips}
              onChange={(on) => updatePreferences({ startupTips: on })}
            />
          </label>
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsPopover;
