/** Settings popover — reads and writes preferences via the wire singletons
 *  (`preferences()` / `updatePreferences(...)`). Only needs open/close state
 *  and trigger ref from the parent. */

import type { Preferences } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { Portal } from "solid-js/web";
import SegmentedControl, {
  type SegmentedControlOption,
} from "../ui/SegmentedControl";
import { surface } from "../ui/Surface";
import Toggle from "../ui/Toggle";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import { preferences, updatePreferences } from "../wire";
import SettingRow, { type Hint } from "./SettingRow";
import { type ColorScheme, useColorScheme } from "./useColorScheme";

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

/** Auto  = system chooses per tile (WebGL on the recently-active tiles plus
 *          their active splits, DOM on others — see `canUseWebgl`, #1403).
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
  auto: { text: "WebGL on recently-active tiles, DOM elsewhere." },
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
  const { colorScheme, setColorScheme } = useColorScheme();

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-end",
  });

  const chrome = surface({ portalled: true });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="settings-popover"
          class={`fixed z-50 ${chrome.class} p-4 min-w-[280px] space-y-4`}
          style={{ ...panelStyle(), ...chrome.style }}
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
