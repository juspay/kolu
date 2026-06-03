/** Screen-scrape detection of Claude Code's awaiting-user prompts (#905).
 *
 *  Claude's `AskUserQuestion` / `ExitPlanMode` dialogs are the one
 *  awaiting-user signal the JSONL classifier (`core.ts`'s
 *  `AWAITING_USER_TOOLS`) can't see: the Claude Agent SDK buffers the in-flight
 *  assistant message carrying the `tool_use` block in memory and flushes it to
 *  the transcript only *after* the user answers, so throughout the wait
 *  `deriveState` reads the prior `end_turn` and reports `waiting`. The prompt
 *  is, however, already painted on the terminal — so we recognize it on the
 *  rendered screen instead of waiting for JSONL that arrives too late.
 *
 *  This file is the Claude-specific *detector* + the promote-only *policy* that
 *  lifts `waiting → awaiting_user` when a prompt is on screen. It is pure and
 *  stateless: a VT-resolved screen snapshot (and the JSONL-derived info) in, a
 *  decision out. Zero `node:*` imports, zero filesystem — the server's poller
 *  feeds it `getScreenText`; `screen.test.ts` feeds it fixtures. The
 *  `ClaudeCodeInfo` import is type-only (erased), so this stays as pure as
 *  `schemas.ts`.
 *
 *  ## Signature — framework chrome, captured live from claude-code v2.1.162
 *  Each marker is a *framework-rendered* string, not model-supplied option text,
 *  so it survives wording drift in the options (the very drift that broke the
 *  earlier signature — see below):
 *
 *  - **AskUserQuestion** — the select footer `↑/↓ to navigate`. Captured ONLY on
 *    this prompt; the idle pickers that also render an option list use a
 *    *different* footer (`/model` → "Enter to set as default · s to use this
 *    session only · Esc to cancel"; the folder-trust prompt → "Enter to confirm
 *    · Esc to cancel"), and the slash / `@` menus render no arrow-nav footer at
 *    all. So this marker does not collide with a user idly browsing a menu while
 *    the session sits at `waiting`.
 *  - **ExitPlanMode** — the header `Ready to code?` (and the older
 *    `…is ready to execute. Would you like to proceed?` phrasing). ExitPlanMode
 *    has NO arrow-nav footer (it shows `shift+tab to approve…` / `ctrl-g to
 *    edit…`), so the AskUserQuestion marker would miss it — it needs its own.
 *
 *  - **Bottom-region gate** — the live prompt renders at the cursor (screen
 *    bottom), so matching is confined to the screen tail; a marker that scrolled
 *    into history can't fire (and once the user answers, the JSONL advances out
 *    of `waiting` and the poll disarms regardless of what lingers on screen).
 *
 *  History: this file used to match option *labels* (`No, keep planning`) and a
 *  caret-row + footer-adjacency structure. Both were fragile and partly wrong —
 *  v2.1.162 renamed that option to `Tell Claude what to change`, and the guessed
 *  AskUserQuestion footer (`↑/↓ to select`) was never the real string. The
 *  markers below are verbatim captures (`tmux capture-pane`, the same VT-resolved
 *  text `getScreenText` returns). Re-confirm them from a live capture on a tool
 *  rename — never from guesses. The JSONL tool names (`core.ts`
 *  `AWAITING_USER_TOOLS`) move on the same release, so they change together. */

import type { ClaudeCodeInfo } from "./schemas.ts";

/** How many lines of the screen tail the gate inspects. The live prompt renders
 *  at the cursor (screen bottom); 40 lines comfortably covers the tallest option
 *  list plus its footer while excluding scrollback that could carry stale
 *  prompt-like words. */
export const TAIL_REGION_LINES = 40;

/** The awaiting-user prompt markers (see the file header for the live-capture
 *  rationale). A match anywhere in the screen tail is proof of a prompt:
 *   - the AskUserQuestion select footer `↑/↓ to navigate` (whitespace around the
 *     slash kept flexible against minor VT spacing) — unique to that prompt;
 *   - the ExitPlanMode header `Ready to code?` and its older
 *     `ready to execute. Would you like to proceed?` phrasing — ExitPlanMode has
 *     no arrow footer, so it can't be caught by the AskUserQuestion marker. */
const PROMPT_MARKERS: ReadonlyArray<string | RegExp> = [
  /↑\s*\/\s*↓\s+to navigate/,
  "Ready to code?",
  "ready to execute. Would you like to proceed?",
];

/** The last block of rendered lines, trailing blank rows trimmed so the "tail"
 *  is the last *painted* content, not the empty rows below a short prompt. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Whether a Claude awaiting-user prompt (`ExitPlanMode`/`AskUserQuestion`) is
 *  painted on the rendered screen — any `PROMPT_MARKERS` entry present in the
 *  screen tail. */
export function screenHasClaudePrompt(screenText: string): boolean {
  const tail = tailRegion(screenText).join("\n");
  return PROMPT_MARKERS.some((m) =>
    typeof m === "string" ? tail.includes(m) : m.test(tail),
  );
}

// --- Promote-only policy (the seam the server poller drives) ---

/** Whether `info` is in a state the screen scrape could promote — the idle gate
 *  for the poll clock, so the screen read only runs during the wait window.
 *  Only a bare `waiting` (the JSONL classifier's read while the SDK buffers the
 *  prompt) is promotable; an in-flight `thinking`/`tool_use` already reads as
 *  working, and an already-`awaiting_user` value has nothing to lift. */
export function isScreenPollable(info: ClaudeCodeInfo): boolean {
  return info.state === "waiting";
}

/** Merge the JSONL-derived `info` with a rendered-screen snapshot: lift
 *  `waiting → awaiting_user` when an `AskUserQuestion`/`ExitPlanMode` prompt is
 *  on screen, otherwise return `info` unchanged (same reference). Promote-only —
 *  it never lowers a state; a genuine state change flows back through the JSONL
 *  watcher. The returned reference identity is the "did anything change?" signal
 *  the poller checks. */
export function promoteFromScreen(
  info: ClaudeCodeInfo,
  screenText: string,
): ClaudeCodeInfo {
  if (info.state !== "waiting") return info;
  return screenHasClaudePrompt(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
