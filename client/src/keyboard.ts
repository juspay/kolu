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
  mod?: boolean;
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
  if (kb.mod && !isPlatformModifier(e)) return false;
  if (!kb.mod && isPlatformModifier(e)) return false;
  if (kb.shift && !e.shiftKey) return false;
  if (!kb.shift && e.shiftKey) return false;
  return true;
}

/** Platform-aware display string for a keybind (e.g. "⌘1" on macOS, "Ctrl+1" elsewhere). */
export function formatKeybind(kb: Keybind): string {
  const parts: string[] = [];
  if (kb.mod) parts.push(isMac ? "⌘" : "Ctrl");
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
    label: "Create new terminal",
  },
  createTerminalInCwd: {
    keybind: { key: "T", code: "KeyT", mod: true, shift: true },
    label: "Create terminal in current directory",
  },
  nextTerminal: {
    keybind: { key: "]", code: "BracketRight", mod: true, shift: true },
    label: "Next terminal",
  },
  prevTerminal: {
    keybind: { key: "[", code: "BracketLeft", mod: true, shift: true },
    label: "Previous terminal",
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
} as const satisfies Record<string, Shortcut>;
