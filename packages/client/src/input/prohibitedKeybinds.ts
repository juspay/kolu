/**
 * Keybinds reserved by tools that commonly run inside kolu PTYs
 * (Claude Code, readline-based shells, etc.). Registering an action
 * whose chord matches one of these would intercept the keystroke
 * before xterm passes it to the PTY — silently breaking the
 * third-party tool for users running it inside kolu.
 *
 * `keyboard.test.ts` iterates `ACTIONS` × `PROHIBITED_KEYBINDS` and
 * fails any collision; that test is the enforcement, this list is
 * the spec. Use physical `ctrl: true` because PTYs see byte-level
 * Ctrl regardless of platform — `mod` would over-narrow to one OS.
 */
import type { Keybind } from "@kolu/platform/keyboard";

export interface ProhibitedKeybind {
  keybind: Keybind;
  tool: string;
  reason: string;
}

export const PROHIBITED_KEYBINDS: readonly ProhibitedKeybind[] = [
  {
    keybind: { key: "b", code: "KeyB", ctrl: true },
    tool: "Claude Code",
    reason: "Background task toggle",
  },
  {
    keybind: { key: "j", code: "KeyJ", ctrl: true },
    tool: "POSIX terminal / readline",
    reason:
      "LF (0x0A) — newline byte every shell and readline-based program consumes",
  },
];
