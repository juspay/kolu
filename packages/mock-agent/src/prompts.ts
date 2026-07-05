/**
 * Canned Claude on-screen prompt renderings the mock-agent PRINTS to its stdout
 * (the PTY) so kolu's server-side screen-scrape (`getScreenText`) sees exactly
 * what real Claude paints. Relocated from the old `paintLinesToTerminal` steps —
 * but printed BY the foreground agent (as production does), not typed by the
 * test as a shell `printf` (which would now hit the mock-agent's own stdin).
 *
 * The exact footer text is load-bearing: the screen-scrape matcher keys on the
 * `·`-separated select/permission footers (AskUserQuestion's `↑/↓ to navigate`,
 * the permission gate's `Tab to amend`). Keep these byte-faithful to the real
 * CLI versions named in each entry.
 */

export const PROMPT_TEMPLATES: Record<string, string[]> = {
  // AskUserQuestion select prompt (claude-code v2.1.162 footer).
  "ask-user-question": [
    " Which database do you prefer?",
    "",
    "❯ 1. Postgres",
    "  2. SQLite",
    "",
    " Enter to select · ↑/↓ to navigate · Esc to cancel",
  ],
  // v2.1.173 added a `· n to add notes` segment between navigate and cancel.
  "ask-user-question-notes": [
    " Which package decomposition is cleanest?",
    "",
    "❯ 1. Entry with behaviour",
    "  2. Supervisor owns the entry",
    "",
    " Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel",
  ],
  // Tool-permission gate (claude-code v2.1.162 `Tab to amend` footer).
  permission: [
    " Do you want to create notes.txt?",
    "❯ 1. Yes",
    "  2. Yes, allow all edits during this session (shift+tab)",
    "  3. No",
    " Esc to cancel · Tab to amend",
  ],
};
