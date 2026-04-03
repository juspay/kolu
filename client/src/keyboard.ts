/**
 * Keyboard shortcut helpers — keybind types, matching, formatting, and
 * the global shortcut registry consumed by useShortcuts and ShortcutsHelp.
 */

import { isMac } from "./platform";

/** Check if the platform modifier key (Cmd on macOS, Ctrl elsewhere) is pressed. */
export function isPlatformModifier(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Zoom key deltas: maps key to font-size change direction. */
export const ZOOM_KEYS: Record<string, 1 | -1> = { "=": 1, "+": 1, "-": -1 };

/**
 * A keyboard shortcut definition. `mod` = Cmd on macOS, Ctrl elsewhere.
 * Use `code` (physical key via KeyboardEvent.code) when Shift changes the
 * reported `e.key` — e.g. Shift+[ reports key="{" but code="BracketLeft".
 */
export interface Keybind {
  /** Display key name (also used for matching when `code` is absent). */
  key: string;
  /** Physical key code (KeyboardEvent.code). Preferred over `key` for matching when set. */
  code?: string;
  /** Platform modifier: Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Always the physical Ctrl key, regardless of platform. Use for shortcuts where Cmd is captured by macOS (e.g. Cmd+`). */
  ctrl?: boolean;
  shift?: boolean;
}

/** A shortcut definition: keybind + human-readable label. */
export interface Shortcut {
  keybind: Keybind;
  label: string;
}

/** Check if a KeyboardEvent matches a keybind definition. */
export function matchesKeybind(e: KeyboardEvent, kb: Keybind): boolean {
  // Prefer physical key code when specified (Shift changes e.key but not e.code)
  const keyMatch = kb.code ? e.code === kb.code : e.key === kb.key;
  if (!keyMatch) return false;
  if (kb.ctrl) {
    // ctrl: always the physical Ctrl key
    if (!e.ctrlKey) return false;
  } else {
    if (kb.mod && !isPlatformModifier(e)) return false;
    if (!kb.mod && isPlatformModifier(e)) return false;
  }
  if (kb.shift && !e.shiftKey) return false;
  if (!kb.shift && e.shiftKey) return false;
  return true;
}

/** Platform-aware display string for a keybind (e.g. "⌘1" on macOS, "Ctrl+1" elsewhere). */
export function formatKeybind(kb: Keybind): string {
  const parts: string[] = [];
  if (kb.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  else if (kb.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (kb.shift) parts.push(isMac ? "⇧" : "Shift");
  const displayKey = kb.key.length === 1 ? kb.key.toUpperCase() : kb.key;
  parts.push(displayKey);
  return isMac ? parts.join("") : parts.join("+");
}

/** Mod+1 through Mod+9 for direct terminal switching. */
const SWITCH_SHORTCUTS = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [
    `switchTo${i + 1}`,
    {
      keybind: { key: String(i + 1), mod: true },
      label: `Switch to terminal ${i + 1}`,
    },
  ]),
) as { [K in `switchTo${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`]: Shortcut };

/** All global keyboard shortcuts with their keybinds and display labels. */
export const SHORTCUTS = {
  ...SWITCH_SHORTCUTS,
  createTerminal: {
    keybind: { key: "t", mod: true },
    label: "New terminal",
  },
  createTerminalAlt: {
    keybind: { key: "Enter", mod: true },
    label: "New terminal",
  },
  nextTerminal: {
    keybind: { key: "]", code: "BracketRight", mod: true, shift: true },
    label: "Next terminal",
  },
  prevTerminal: {
    keybind: { key: "[", code: "BracketLeft", mod: true, shift: true },
    label: "Previous terminal",
  },
  nextTerminalTab: {
    keybind: { key: "Tab", code: "Tab", ctrl: true },
    label: "Quick switch (Mission Control)",
  },
  prevTerminalTab: {
    keybind: { key: "Tab", code: "Tab", ctrl: true, shift: true },
    label: "Quick switch (reverse)",
  },
  commandPalette: {
    keybind: { key: "k", mod: true },
    label: "Command palette",
  },
  shortcutsHelp: { keybind: { key: "/", mod: true }, label: "Shortcuts help" },
  findInTerminal: {
    keybind: { key: "f", mod: true },
    label: "Find in terminal",
  },
  zoomIn: { keybind: { key: "+", mod: true }, label: "Zoom in" },
  zoomOut: { keybind: { key: "-", mod: true }, label: "Zoom out" },
  zoomReset: { keybind: { key: "0", mod: true }, label: "Reset zoom" },
  toggleSubPanel: {
    keybind: { key: "`", code: "Backquote", ctrl: true },
    label: "Toggle sub-panel",
  },
  createSubTerminal: {
    keybind: { key: "`", code: "Backquote", ctrl: true, shift: true },
    label: "New sub-terminal",
  },
  nextSubTab: {
    keybind: { key: "PageDown", code: "PageDown", ctrl: true },
    label: "Next sub-tab",
  },
  prevSubTab: {
    keybind: { key: "PageUp", code: "PageUp", ctrl: true },
    label: "Previous sub-tab",
  },
  missionControl: {
    keybind: { key: ".", mod: true },
    label: "Mission Control",
  },
  randomizeTheme: {
    keybind: { key: "j", mod: true },
    label: "Random theme",
  },
  copyTerminalText: {
    keybind: { key: "C", code: "KeyC", mod: true, shift: true },
    label: "Copy terminal text",
  },
} as const satisfies Record<string, Shortcut>;

/**
 * Check if a KeyboardEvent matches any registered app shortcut.
 * Used by xterm's key handler to let app shortcuts bubble through
 * instead of being consumed by the terminal.
 */
export function matchesAnyShortcut(e: KeyboardEvent): boolean {
  // Alt+Tab: not in SHORTCUTS (handled specially in useShortcuts) but must not leak to terminal
  if (e.altKey && e.key === "Tab") return true;
  return Object.values(SHORTCUTS).some((s) => matchesKeybind(e, s.keybind));
}
