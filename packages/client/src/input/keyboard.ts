/**
 * Keyboard shortcut primitives — keybind types, matching, and platform-aware
 * formatting. The application-level action registry (label + handler + chord)
 * lives in `./actions.ts`.
 */

import { isMac as detectedIsMac } from "./platform";

/** Check if the platform modifier key (Cmd on macOS, Ctrl elsewhere) is
 *  pressed. `isMac` defaults to the detected host platform; pass it
 *  explicitly to keep the check a pure function of platform — for tests, or
 *  to reason about a chord for a non-host OS — instead of reaching for the
 *  module-level `userAgent` singleton. */
export function isPlatformModifier(
  e: KeyboardEvent,
  isMac = detectedIsMac,
): boolean {
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
  /** Physical Alt/Option key. Used for chords macOS Chrome intercepts (e.g. Alt+Tab as an alternate to Ctrl+Tab). */
  alt?: boolean;
  shift?: boolean;
  /** Match whether shift is pressed or not. Used by stateful actions
   *  (e.g. MRU cycling) where shift modulates direction rather than
   *  participating in the chord identity. */
  shiftOptional?: boolean;
}

/** Check if a KeyboardEvent matches a keybind definition. `isMac` defaults to
 *  the detected host platform; injected by tests to exercise both. */
export function matchesKeybind(
  e: KeyboardEvent,
  kb: Keybind,
  isMac = detectedIsMac,
): boolean {
  // Prefer physical key code when specified (Shift changes e.key but not e.code)
  const keyMatch = kb.code ? e.code === kb.code : e.key === kb.key;
  if (!keyMatch) return false;
  if (kb.alt) {
    if (!e.altKey) return false;
  } else if (e.altKey) {
    return false;
  }
  if (kb.ctrl) {
    // ctrl: always the physical Ctrl key
    if (!e.ctrlKey) return false;
  } else {
    if (kb.mod && !isPlatformModifier(e, isMac)) return false;
    if (!kb.mod && !kb.alt && isPlatformModifier(e, isMac)) return false;
  }
  if (!kb.shiftOptional) {
    if (kb.shift && !e.shiftKey) return false;
    if (!kb.shift && e.shiftKey) return false;
  }
  return true;
}

/**
 * Synthesize a KeyboardEvent shape from a Keybind. Used by the
 * `PROHIBITED_KEYBINDS` collision test to ask "would the prohibited
 * chord match this registered action?" without constructing a real
 * event. Resolves `mod` against the platform — same path `matchesKeybind`
 * takes — so there's one source of modifier truth. `isMac` defaults to the
 * detected host platform.
 */
export function keybindAsEvent(
  kb: Keybind,
  isMac = detectedIsMac,
): Partial<KeyboardEvent> {
  const modCtrl = kb.mod && !isMac;
  const modMeta = kb.mod && isMac;
  return {
    key: kb.key,
    code: kb.code,
    ctrlKey: kb.ctrl === true || modCtrl,
    metaKey: modMeta,
    altKey: kb.alt === true,
    shiftKey: kb.shift === true,
  };
}

/** Platform-aware display string for a keybind (e.g. "⌘1" on macOS, "Ctrl+1"
 *  elsewhere). `isMac` defaults to the detected host platform. */
export function formatKeybind(kb: Keybind, isMac = detectedIsMac): string {
  const parts: string[] = [];
  if (kb.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  else if (kb.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (kb.alt) parts.push(isMac ? "⌥" : "Alt");
  if (kb.shift) parts.push(isMac ? "⇧" : "Shift");
  const displayKey = kb.key.length === 1 ? kb.key.toUpperCase() : kb.key;
  parts.push(displayKey);
  return isMac ? parts.join("") : parts.join("+");
}
