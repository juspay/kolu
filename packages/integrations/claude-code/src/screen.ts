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
 *  ## Signature (measured: 0 changes across 82 Claude releases, 2.1.77→2.1.159)
 *  - **ExitPlanMode** — exact literals, boolean-certain: `Ready to code?`,
 *    `…is ready to execute. Would you like to proceed?`, `No, keep planning`.
 *  - **AskUserQuestion** — structural: a *caret-marked numbered option row*
 *    (`❯ 1. …`, ASCII fallback `> 1. …`) with an arrow-key select footer a few
 *    lines below it. The caret must sit on a numbered option — a bare `> `
 *    blockquote or shell-continuation line is not enough — and the footer must
 *    be structurally adjacent, so an idle screen that merely mentions "to
 *    navigate" somewhere can't co-occur into a false prompt. Question + option
 *    labels are model-supplied, so they are NOT part of the signature.
 *  - **No box-drawing glyphs** — Claude's prompt boxes have no `╭/┌` corners,
 *    so the signature must never depend on borders.
 *  - **Bottom-region gate** — the live prompt renders at the cursor (screen
 *    bottom), so matching is confined to the screen tail; stale scrollback that
 *    merely contains the word "proceed" can't false-positive.
 *
 *  Same volatility, two transports: when Anthropic renames a tool, the
 *  on-screen literal here AND the JSONL tool name (`core.ts`
 *  `AWAITING_USER_TOOLS`) change in the same release — one coordinated edit.
 *  Tighten these signatures from fresh live captures, never from guesses. */

import type { ClaudeCodeInfo } from "./schemas.ts";

/** How many lines of the screen tail the gate inspects. The live prompt renders
 *  at the cursor (screen bottom); 40 lines comfortably covers the tallest option
 *  list plus its footer while excluding scrollback that could carry stale
 *  prompt-like words. */
export const TAIL_REGION_LINES = 40;

/** ExitPlanMode literals — any one is boolean-certain proof of the plan-exit
 *  dialog. `No, keep planning` is the option unique to it; `Ready to code?` is
 *  the header newer releases lead with; the `ready to execute. Would you like
 *  to proceed?` phrasing is anchored to its prefix so a bare "Would you like to
 *  proceed?" elsewhere on screen can't trip it. */
const EXIT_PLAN_LITERALS = [
  "Ready to code?",
  "No, keep planning",
  "ready to execute. Would you like to proceed?",
] as const;

/** The highlighted option row Claude paints: an optional leading indent, the
 *  select caret (`❯`, ASCII fallback `>`), a space, then a *numbered* option
 *  (`1.`, `2.`, …). Anchoring the caret to a numbered option — not just any
 *  `> ` line — is what keeps a markdown blockquote, shell-continuation prompt,
 *  quoted email, or diff/log line from satisfying the caret half of the
 *  signature. */
const OPTION_ROW_RE = /^\s*(?:❯|>)\s+\d+\.\s/;

/** The arrow-key select hint Claude renders under an option list: either the
 *  glyphs themselves (`↑`/`↓`) or an explicit "to select" / "to navigate"
 *  footer. Required *structurally adjacent* to the caret-marked option row (see
 *  `hasSelectPrompt`), so an arrow glyph or "to navigate" phrase drifting
 *  elsewhere through the tail can't co-occur into a false match. */
const SELECT_FOOTER_RE = /[↑↓]|to (?:select|navigate)/i;

/** How many lines below the caret-marked option row the footer may sit and still
 *  count as part of the same prompt. Covers the tallest option list's blank
 *  separator before its footer without reaching unrelated tail content. */
const FOOTER_LOOKAHEAD_LINES = 12;

/** The last block of rendered lines, trailing blank rows trimmed so the "tail"
 *  is the last *painted* content, not the empty rows below a short prompt. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Whether the tail holds an AskUserQuestion select prompt: a caret-marked
 *  numbered option row with an arrow-key footer within the next few lines. The
 *  adjacency requirement is the anchor — a bare `> ` blockquote can't satisfy
 *  the caret (it isn't a numbered option), and a stray "to navigate" elsewhere
 *  can't satisfy the footer (it must trail an actual option row). */
function hasSelectPrompt(lines: string[]): boolean {
  for (let i = 0; i < lines.length; i++) {
    if (!OPTION_ROW_RE.test(lines[i] ?? "")) continue;
    const footerWindow = lines
      .slice(i + 1, i + 1 + FOOTER_LOOKAHEAD_LINES)
      .join("\n");
    if (SELECT_FOOTER_RE.test(footerWindow)) return true;
  }
  return false;
}

/** Whether a Claude awaiting-user prompt (`ExitPlanMode`/`AskUserQuestion`) is
 *  painted on the rendered screen. */
export function screenHasClaudePrompt(screenText: string): boolean {
  const lines = tailRegion(screenText);

  // ExitPlanMode: its literals are boolean-certain.
  if (EXIT_PLAN_LITERALS.some((lit) => lines.join("\n").includes(lit))) {
    return true;
  }

  // AskUserQuestion: a caret-marked numbered option row with the arrow-key
  // footer structurally adjacent (within a few lines below it).
  return hasSelectPrompt(lines);
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
