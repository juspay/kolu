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
import type { Keybind } from "./keyboard";

export interface ProhibitedKeybind {
  keybind: Keybind;
  tool: string;
  reason: string;
}

/** oh-my-pi's chords, transcribed from omp's own default tables — its
 *  `config/keybindings.ts` plus `@oh-my-pi/pi-tui`'s editor table
 *  (`docs/keybindings.md` documents the user-facing subset). omp's composer is
 *  a full readline keyboard and its TUI claims a wide set of plain Ctrl
 *  chords, every one of which must reach the PTY. */
const OMP_TOOL = "oh-my-pi";

/** Plain Ctrl+<letter> chords omp's editor and app tables bind, with the action
 *  each one fires inside omp. The letter doubles as the physical-code suffix
 *  (`KeyK`), which is the spelling `matchesKeybind` prefers so a Shift-changed
 *  `event.key` cannot slip past the fence.
 *
 *  Four chords omp claims are deliberately ABSENT, because kolu itself already
 *  intercepts them (each a `mod: true` action, i.e. plain Ctrl on
 *  Linux/Windows): Ctrl+T and Ctrl+Enter → `createTerminal`, Ctrl+K →
 *  `commandPalette`, Ctrl+F → `findInTerminal`. On macOS `mod` is Cmd and omp
 *  sees its own chord, so this is a Linux/Windows-only theft — and a
 *  pre-existing one, not something this list may resolve by itself: listing
 *  them would red `keyboard.test.ts` (the fence's whole job) and the only
 *  remedy it accepts is rebinding kolu's own shortcuts, a user-facing product
 *  change of its own. */
const OMP_CTRL_LETTERS: readonly (readonly [string, string])[] = [
  ["a", "Start of line"],
  ["c", "Clear screen or cancel"],
  ["d", "Exit application / delete character"],
  ["e", "End of line"],
  ["g", "Open the draft in $EDITOR"],
  ["l", "Start or stop live voice mode"],
  ["o", "Expand tool output"],
  ["p", "Cycle to the next model"],
  ["q", "Queue a follow-up message"],
  ["r", "Search prompt history"],
  ["s", "Open the agent hub / toggle session sort"],
  ["u", "Delete to start of line"],
  ["v", "Paste from the clipboard"],
  ["w", "Delete the previous word"],
  ["y", "Yank"],
  ["z", "Suspend the application"],
];

const OMP_CTRL_KEYBINDS: readonly ProhibitedKeybind[] = OMP_CTRL_LETTERS.map(
  ([letter, reason]) => ({
    keybind: {
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      ctrl: true,
    },
    tool: OMP_TOOL,
    reason,
  }),
);

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
  // A readline-family chord omp binds in its editor: Ctrl+B is also omp's
  // "move cursor left" — the Claude Code entry above already fences it.
  ...OMP_CTRL_KEYBINDS,
  {
    keybind: { key: "Tab", code: "Tab", shift: true },
    tool: OMP_TOOL,
    reason: "Cycle thinking level",
  },
  {
    keybind: { key: "Backspace", code: "Backspace", ctrl: true },
    tool: OMP_TOOL,
    reason: "Delete the previous word / delete a session in the picker",
  },
  {
    keybind: { key: "ArrowLeft", code: "ArrowLeft", ctrl: true },
    tool: OMP_TOOL,
    reason: "Fold or move up",
  },
  {
    keybind: { key: "ArrowRight", code: "ArrowRight", ctrl: true },
    tool: OMP_TOOL,
    reason: "Unfold or move down",
  },
  {
    keybind: { key: "O", code: "KeyO", ctrl: true, shift: true },
    tool: OMP_TOOL,
    reason: "Show or hide tool activity",
  },
  {
    keybind: { key: "P", code: "KeyP", ctrl: true, shift: true },
    tool: OMP_TOOL,
    reason: "Cycle to the previous model",
  },
  {
    keybind: { key: "V", code: "KeyV", ctrl: true, shift: true },
    tool: OMP_TOOL,
    reason: "Paste clipboard text without collapsing it",
  },
  {
    keybind: { key: "F5", code: "F5" },
    tool: OMP_TOOL,
    reason: "Retry the last failed assistant turn",
  },
];
