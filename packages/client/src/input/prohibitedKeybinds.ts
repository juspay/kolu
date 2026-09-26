/**
 * Keybinds reserved by tools that commonly run inside kolu PTYs
 * (Claude Code, readline-based shells, etc.). Registering an action
 * whose chord matches one of these would intercept the keystroke
 * before xterm passes it to the PTY — silently breaking the
 * third-party tool for users running it inside kolu.
 *
 * `keyboard.test.ts` iterates `ACTIONS` × `PROHIBITED_KEYBINDS` and
 * fails any collision; that test is the enforcement, this list is
 * the spec. Every entry is `modifier: "ctrl"` — the physical key, on every
 * platform — because that is what a PTY reads; `"cmdOrCtrl"` would over-narrow
 * to one OS, and `"app"` (Cmd / Super) is the role a PTY can never see, which
 * is why it is the remedy for a collision rather than a way to spell one. See
 * `ChordModifier` in `./keyboard.ts` for that rule.
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
 *  `event.key` cannot slip past the fence. */
const OMP_CTRL_LETTERS: readonly (readonly [string, string])[] = [
  ["a", "Start of line"],
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
];

const OMP_CTRL_KEYBINDS: readonly ProhibitedKeybind[] = OMP_CTRL_LETTERS.map(
  ([letter, reason]) => ({
    keybind: {
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      modifier: "ctrl",
    },
    tool: OMP_TOOL,
    reason,
  }),
);

export const PROHIBITED_KEYBINDS: readonly ProhibitedKeybind[] = [
  {
    keybind: { key: "b", code: "KeyB", modifier: "ctrl" },
    tool: "Claude Code",
    reason: "Background task toggle",
  },
  {
    keybind: { key: "j", code: "KeyJ", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason:
      "LF (0x0A) — newline byte every shell and readline-based program consumes",
  },
  // Ctrl+C / Ctrl+D / Ctrl+Z are line-discipline signals (SIGINT / EOF /
  // SIGTSTP) every PTY program relies on: they belong here, not under a
  // particular tool — even though omp's keybinding tables also claim them.
  {
    keybind: { key: "c", code: "KeyC", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason: "SIGINT — interrupt the foreground process",
  },
  {
    keybind: { key: "d", code: "KeyD", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason: "EOF — end of input / delete character under the cursor",
  },
  {
    keybind: { key: "z", code: "KeyZ", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason: "SIGTSTP — suspend the foreground process",
  },
  // Three readline EDITING chords — bash's own default table (`bind -p`) reports
  // kill-line / forward-char / transpose-chars — that kolu itself used to eat off
  // macOS, back when `commandPalette`, `findInTerminal` and `createTerminal` were
  // `"cmdOrCtrl"` (plain Ctrl there). They are ordinary entries now because those
  // three moved to `"app"`. The fence, not a comment, is what keeps them free.
  {
    keybind: { key: "k", code: "KeyK", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason: "kill-line — delete to end of line",
  },
  {
    keybind: { key: "f", code: "KeyF", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason: "forward-char — move the cursor right",
  },
  {
    keybind: { key: "t", code: "KeyT", modifier: "ctrl" },
    tool: "POSIX terminal / readline",
    reason:
      "transpose-chars — swap the two characters at the cursor (omp binds it to its thinking-mode toggle)",
  },
  {
    keybind: { key: "Enter", code: "Enter", modifier: "ctrl" },
    tool: OMP_TOOL,
    reason: "Send follow-up message",
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
    keybind: { key: "Backspace", code: "Backspace", modifier: "ctrl" },
    tool: OMP_TOOL,
    reason: "Delete the previous word / delete a session in the picker",
  },
  {
    keybind: { key: "ArrowLeft", code: "ArrowLeft", modifier: "ctrl" },
    tool: OMP_TOOL,
    reason: "Fold or move up",
  },
  {
    keybind: { key: "ArrowRight", code: "ArrowRight", modifier: "ctrl" },
    tool: OMP_TOOL,
    reason: "Unfold or move down",
  },
  {
    keybind: { key: "O", code: "KeyO", modifier: "ctrl", shift: true },
    tool: OMP_TOOL,
    reason: "Show or hide tool activity",
  },
  {
    keybind: { key: "P", code: "KeyP", modifier: "ctrl", shift: true },
    tool: OMP_TOOL,
    reason: "Cycle to the previous model",
  },
  {
    keybind: { key: "V", code: "KeyV", modifier: "ctrl", shift: true },
    tool: OMP_TOOL,
    reason: "Paste clipboard text without collapsing it",
  },
  {
    keybind: { key: "F5", code: "F5" },
    tool: OMP_TOOL,
    reason: "Retry the last failed assistant turn",
  },
];
