import type {
  NewTerminalTheme,
  Preferences,
  ShuffleBehavior,
} from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { AGENTS_PROFILE_MENU_TESTID } from "../agents/AgentsProfileList";
import AgentsSettingsSection from "../agents/AgentsSettingsSection";
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

const SCHEME_HINT: Record<ColorScheme, Hint> = {
  light: { text: "Light UI at all times." },
  dark: { text: "Dark UI at all times." },
  system: { text: "Match your OS appearance." },
};

const RENDERER_OPTIONS: readonly SegmentedControlOption<
  Preferences["terminalRenderer"]
>[] = [
  { value: "auto", label: "Auto" },
  { value: "webgl", label: "WebGL" },
  { value: "dom", label: "DOM" },
];

const RENDERER_HINT: Record<Preferences["terminalRenderer"], Hint> = {
  auto: {
    text: "WebGL on recently-active tiles, DOM elsewhere — same grid either way.",
  },
  webgl: {
    text: "WebGL on every tile — may thrash past ~16 terminals.",
    tone: "warn",
  },
  dom: { text: "DOM renderer; lowest GPU but more RAM. Auto is recommended." },
};

const NEW_TERMINAL_THEME_OPTIONS: readonly SegmentedControlOption<NewTerminalTheme>[] =
  [
    { value: "inherit", label: "Inherit" },
    { value: "shuffle", label: "Shuffle" },
  ];

const NEW_TERMINAL_THEME_HINT: Record<NewTerminalTheme, Hint> = {
  inherit: { text: "New terminals copy the active terminal's theme." },
  shuffle: {
    text: "New terminals get a distinct tint (see Shuffle behaviour).",
  },
};

const SHUFFLE_BEHAVIOR_OPTIONS: readonly SegmentedControlOption<ShuffleBehavior>[] =
  [
    { value: "random", label: "Random" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "auto", label: "Auto" },
    { value: "colourful", label: "Colourful" },
  ];

const SHUFFLE_BEHAVIOR_HINT: Record<ShuffleBehavior, Hint> = {
  random: { text: "Any tint, light or dark — the whole catalogue." },
  dark: { text: "Dark tints only." },
  light: { text: "Light tints only." },
  auto: { text: "Match the app's light/dark mode." },
  colourful: {
    text: "Saturated tints only — skip grey / monochrome schemes.",
  },
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
    isInside: (node) =>
      (node instanceof Element ? node : node.parentElement)?.closest(
        `[data-testid="${AGENTS_PROFILE_MENU_TESTID}"]`,
      ) != null,
  });

  const chrome = surface({ portalled: true });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="settings-popover"
          class={`fixed z-50 ${chrome.class} p-4 w-[min(92vw,30rem)] max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain space-y-4`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <SettingRow
            label="Theme"
            hint={SCHEME_HINT[colorScheme()]}
            doc="theming"
          >
            <SegmentedControl
              options={SCHEME_OPTIONS}
              value={colorScheme()}
              onChange={setColorScheme}
              testIdPrefix="color-scheme"
            />
          </SettingRow>
          <SettingRow
            label="New terminal theme"
            hint={NEW_TERMINAL_THEME_HINT[preferences().newTerminalTheme]}
            doc="theming"
          >
            <SegmentedControl
              options={NEW_TERMINAL_THEME_OPTIONS}
              value={preferences().newTerminalTheme}
              onChange={(v) => updatePreferences({ newTerminalTheme: v })}
              testIdPrefix="new-terminal-theme"
            />
          </SettingRow>
          <SettingRow
            label="Shuffle behaviour"
            hint={SHUFFLE_BEHAVIOR_HINT[preferences().shuffleBehavior]}
          >
            <SegmentedControl
              options={SHUFFLE_BEHAVIOR_OPTIONS}
              value={preferences().shuffleBehavior}
              onChange={(v) => updatePreferences({ shuffleBehavior: v })}
              testIdPrefix="shuffle-behavior"
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
            label="Attention alerts"
            hint={{
              text: "Sound + notification when a background terminal finishes.",
            }}
            doc="notifications"
          >
            <Toggle
              testId="attention-alerts-toggle"
              enabled={preferences().attentionAlerts}
              onChange={(on) => updatePreferences({ attentionAlerts: on })}
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
          <AgentsSettingsSection />
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsPopover;
