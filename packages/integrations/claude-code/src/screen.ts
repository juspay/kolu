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
 *  ## Signature — one framework-rendered marker (claude-code v2.1.162, captured live)
 *  `AskUserQuestion`'s select footer `↑/↓ to navigate` — framework chrome, not
 *  the model-supplied question/option text, so it survives option-label churn.
 *  Captured ONLY on this prompt; the look-alikes a user might have on screen at
 *  `waiting` all use a *different* footer, so none collide:
 *   - Claude's own `/fork` agent list → `↑/↓ to select · Enter to view` — "to
 *     select", NOT "to navigate";
 *   - `/model` picker → "Enter to set as default · s to use this session only";
 *   - folder-trust prompt → "Enter to confirm · Esc to cancel";
 *   - slash / `@` menus → no arrow footer at all.
 *
 *  Deliberately a *single* marker. `ExitPlanMode` is NOT detected in this cut —
 *  its dialog has no arrow footer (`Ready to code?` + `shift+tab to approve…`),
 *  so it would need a separate, more volatile string literal. A small,
 *  high-confidence surface we grow over time beats a broad one that
 *  false-promotes; ExitPlanMode (and the hook-based path) is a follow-up.
 *
 *  Bottom-region gate: the live prompt renders at the cursor (screen bottom), so
 *  matching is confined to the screen tail — a footer scrolled into history can't
 *  fire, and once the user answers, the JSONL advances out of `waiting` and the
 *  poll disarms regardless of what lingers on screen.
 *
 *  Re-confirm the marker from a live capture (`tmux capture-pane`, the same
 *  VT-resolved text `getScreenText` returns) on any Claude UI change — never from
 *  a guess (the earlier guessed footer `↑/↓ to select` was never real and would
 *  have collided with the `/fork` agent list above). */

import type { ClaudeCodeInfo } from "./schemas.ts";

/** How many lines of the screen tail the gate inspects. The live prompt renders
 *  at the cursor (screen bottom); 40 lines comfortably covers the tallest option
 *  list plus its footer while excluding scrollback that could carry stale
 *  prompt-like words. */
export const TAIL_REGION_LINES = 40;

/** The one awaiting-user marker: `AskUserQuestion`'s select footer
 *  `↑/↓ to navigate` (whitespace around the slash kept flexible against minor VT
 *  spacing). See the file header for why this single marker, and why the
 *  look-alike footers (`↑/↓ to select` on Claude's `/fork` agent list, the
 *  `/model` and trust pickers) deliberately don't match. */
const NAV_FOOTER_RE = /↑\s*\/\s*↓\s+to navigate/;

/** The last block of rendered lines, trailing blank rows trimmed so the "tail"
 *  is the last *painted* content, not the empty rows below a short prompt. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Whether a Claude `AskUserQuestion` prompt is painted on the rendered screen —
 *  its `↑/↓ to navigate` select footer present in the screen tail. */
export function screenHasClaudePrompt(screenText: string): boolean {
  return NAV_FOOTER_RE.test(tailRegion(screenText).join("\n"));
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
