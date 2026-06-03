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
 *  - **AskUserQuestion** — structural: a select caret (`❯`, ASCII fallback `>`)
 *    AND an arrow-key select footer. Question + option labels are
 *    model-supplied, so they are NOT part of the signature.
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

/** A recognized Claude prompt awaiting the human, discriminated by the tool
 *  that produced it. `question` is best-effort tooltip text for AskUserQuestion
 *  (null when no clean candidate is found) — the promotion never depends on it. */
export type ClaudeScreenPrompt =
  | { tool: "ExitPlanMode" }
  | { tool: "AskUserQuestion"; question: string | null };

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

/** The highlighted-option row Claude paints: a select caret (`❯`, ASCII
 *  fallback `>`) at the START of a line (after optional indentation), a space,
 *  then a NUMBERED option (`1.`, `2)`). Anchoring the caret to an option row —
 *  not "any whitespace-delimited `>`" — is what keeps `cat > file` and Markdown
 *  blockquotes (`> quoted text`) out: a shell redirect has no line-leading
 *  caret marking a numbered option, so it can't satisfy the signature. */
const SELECT_CARET_RE = /^\s*(?:❯|>)\s+\d+[.)]/m;

/** The arrow-key select hint Claude renders under an option list: either the
 *  glyphs themselves (`↑`/`↓`) or an explicit "to select" / "to navigate"
 *  footer. Required in conjunction with the caret-marked option row, so prose
 *  containing "to select" can't match without an actual option list above it. */
const SELECT_FOOTER_RE = /[↑↓]|to (?:select|navigate)/i;

/** A numbered option row (`❯ 1. …`, `2) …`), used to exclude option lines when
 *  hunting for the question text above them. */
const OPTION_ROW_RE = /^(?:❯|>)?\s*\d+[.)]/;

/** The last block of rendered lines, trailing blank rows trimmed so the "tail"
 *  is the last *painted* content, not the empty rows below a short prompt. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Recognize a Claude awaiting-user prompt on the rendered screen, or null. */
export function detectClaudePrompt(
  screenText: string,
): ClaudeScreenPrompt | null {
  const region = tailRegion(screenText);
  const text = region.join("\n");

  // ExitPlanMode first: its literals are boolean-certain, and its dialog also
  // carries the generic select structure — checking it first keeps the
  // discriminated union unambiguous (a plan exit never reads as a question).
  if (EXIT_PLAN_LITERALS.some((lit) => text.includes(lit))) {
    return { tool: "ExitPlanMode" };
  }

  // AskUserQuestion: structural conjunction — a select caret AND the arrow-key
  // footer, both within the tail region.
  if (SELECT_CARET_RE.test(text) && SELECT_FOOTER_RE.test(text)) {
    return { tool: "AskUserQuestion", question: extractQuestion(region) };
  }

  return null;
}

/** Best-effort question text: the nearest non-empty, non-option, non-footer line
 *  above the first option caret. Null when no clean candidate is found. */
function extractQuestion(region: string[]): string | null {
  const caretIdx = region.findIndex((l) => SELECT_CARET_RE.test(l));
  if (caretIdx <= 0) return null;
  for (let i = caretIdx - 1; i >= 0; i--) {
    const line = (region[i] ?? "").trim();
    if (line === "") continue;
    if (SELECT_FOOTER_RE.test(line)) continue;
    if (OPTION_ROW_RE.test(line)) continue;
    return line;
  }
  return null;
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
  return detectClaudePrompt(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
