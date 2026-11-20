import type { Keybind } from "./keyboard";

export interface ProhibitedKeybind {
  keybind: Keybind;
  tool: string;
  reason: string;
}

const OMP_TOOL = "oh-my-pi";

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
