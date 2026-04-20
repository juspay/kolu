/** Settings popover — reads and writes preferences via usePreferences directly.
 *  Only needs open/close state and trigger ref from the parent. */

import { type Component, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { makeEventListener } from "@solid-primitives/event-listener";
import Toggle from "../ui/Toggle";
import SegmentedControl, {
  type SegmentedControlOption,
} from "../ui/SegmentedControl";
import SettingRow, { type Hint } from "./SettingRow";
import { usePreferences } from "./usePreferences";
import { useColorScheme, type ColorScheme } from "./useColorScheme";
import type { Preferences } from "kolu-common";

const SCHEME_OPTIONS: readonly SegmentedControlOption<ColorScheme>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const SCHEME_HINT: Record<ColorScheme, Hint> = {
  light: { text: "Light UI at all times." },
  dark: { text: "Dark UI at all times." },
  system: { text: "Match your OS appearance." },
};

/** Auto  = system chooses per tile (WebGL on focused, DOM on others).
 *  WebGL = WebGL on every tile (higher throughput; reintroduces #575
 *          context-budget risk with many terminals).
 *  DOM   = force DOM everywhere; no font shift on focus swap. */
const RENDERER_OPTIONS: readonly SegmentedControlOption<
  Preferences["terminalRenderer"]
>[] = [
  { value: "auto", label: "Auto" },
  { value: "webgl", label: "WebGL" },
  { value: "dom", label: "DOM" },
];

const RENDERER_HINT: Record<Preferences["terminalRenderer"], Hint> = {
  auto: { text: "WebGL on focused tiles, DOM elsewhere." },
  webgl: {
    text: "WebGL on every tile — may thrash past ~16 terminals.",
    tone: "warn",
  },
  dom: { text: "DOM renderer; lowest GPU, stable font on focus." },
};

const SHUFFLE_HINT: Hint = {
  text: "New terminals pick a distinct background tint.",
};
const SCROLL_LOCK_HINT: Hint = {
  text: "Hold new output while scrolled up; release at bottom.",
};
const ACTIVITY_ALERTS_HINT: Hint = {
  text: "Sound + notification when a background terminal finishes.",
};
const STARTUP_TIPS_HINT: Hint = {
  text: "Show a random tip when Kolu launches.",
};

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
          class="fixed z-50 bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-3 min-w-[240px] space-y-3"
          style={{
            top: `${pos().top}px`,
            right: `${pos().right}px`,
            "background-color": "var(--color-surface-1)",
          }}
        >
          <SettingRow label="Theme" hint={SCHEME_HINT[colorScheme()]}>
            <SegmentedControl
              options={SCHEME_OPTIONS}
              value={colorScheme()}
              onChange={setColorScheme}
              testIdPrefix="color-scheme"
            />
          </SettingRow>
          <SettingRow label="Shuffle theme" hint={SHUFFLE_HINT}>
            <Toggle
              testId="shuffle-theme-toggle"
              enabled={preferences().shuffleTheme}
              onChange={(on) => updatePreferences({ shuffleTheme: on })}
            />
          </SettingRow>
          <SettingRow label="Scroll lock" hint={SCROLL_LOCK_HINT}>
            <Toggle
              testId="scroll-lock-toggle"
              enabled={preferences().scrollLock}
              onChange={(on) => updatePreferences({ scrollLock: on })}
            />
          </SettingRow>
          <SettingRow label="Activity alerts" hint={ACTIVITY_ALERTS_HINT}>
            <Toggle
              testId="activity-alerts-toggle"
              enabled={preferences().activityAlerts}
              onChange={(on) => updatePreferences({ activityAlerts: on })}
            />
          </SettingRow>
          <SettingRow
            label="Renderer"
            hint={RENDERER_HINT[preferences().terminalRenderer]}
          >
            <SegmentedControl
              options={RENDERER_OPTIONS}
              value={preferences().terminalRenderer}
              onChange={(v) => updatePreferences({ terminalRenderer: v })}
              testIdPrefix="terminal-renderer"
            />
          </SettingRow>
          <SettingRow label="Startup tips" hint={STARTUP_TIPS_HINT}>
            <Toggle
              testId="startup-tips-toggle"
              enabled={preferences().startupTips}
              onChange={(on) => updatePreferences({ startupTips: on })}
            />
          </SettingRow>
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsPopover;
