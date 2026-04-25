/** Settings popover — reads and writes preferences via usePreferences directly.
 *  Only needs open/close state and trigger ref from the parent. */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { Preferences } from "kolu-common";
import { type Component, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import SegmentedControl, {
  type SegmentedControlOption,
} from "../ui/SegmentedControl";
import Toggle from "../ui/Toggle";
import SettingRow, { type Hint } from "./SettingRow";
import { type ColorScheme, useColorScheme } from "./useColorScheme";
import { usePreferences } from "./usePreferences";

const SCHEME_OPTIONS: readonly SegmentedControlOption<ColorScheme>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Reactive hint table — re-read on every color-scheme change. */
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

/** Reactive hint table — re-read on every renderer change. "warn" tone flags
 *  the WebGL-every-tile context-thrash trade-off surfaced in #636. */
const RENDERER_HINT: Record<Preferences["terminalRenderer"], Hint> = {
  auto: { text: "WebGL on focused tiles, DOM elsewhere." },
  webgl: {
    text: "WebGL on every tile — may thrash past ~16 terminals.",
    tone: "warn",
  },
  dom: { text: "DOM renderer; lowest GPU, stable font on focus." },
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
          class="fixed z-50 bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-4 min-w-[280px] space-y-4"
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
          <SettingRow
            label="Shuffle theme"
            hint={{ text: "New terminals pick a distinct background tint." }}
          >
            <Toggle
              testId="shuffle-theme-toggle"
              enabled={preferences().shuffleTheme}
              onChange={(on) => updatePreferences({ shuffleTheme: on })}
            />
          </SettingRow>
          <SettingRow
            label="Match OS appearance"
            hint={{
              text: "Terminals on supported themes (Catppuccin, Gruvbox, Tokyo Night, …) flip to their light/dark sibling with your OS scheme. Pill colors stay stable.",
            }}
          >
            <Toggle
              testId="terminals-follow-os-toggle"
              enabled={preferences().terminalsFollowOSScheme}
              onChange={(on) =>
                updatePreferences({ terminalsFollowOSScheme: on })
              }
            />
          </SettingRow>
          <SettingRow
            label="Scroll lock"
            hint={{
              text: "Hold new output while scrolled up; release at bottom.",
            }}
          >
            <Toggle
              testId="scroll-lock-toggle"
              enabled={preferences().scrollLock}
              onChange={(on) => updatePreferences({ scrollLock: on })}
            />
          </SettingRow>
          <SettingRow
            label="Activity alerts"
            hint={{
              text: "Sound + notification when a background terminal finishes.",
            }}
          >
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
          <SettingRow
            label="Startup tips"
            hint={{ text: "Show a random tip when Kolu launches." }}
          >
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
