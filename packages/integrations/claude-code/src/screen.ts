/** Screen-scrape detection of Claude Code's awaiting-user prompts (#905).
 *
 *  Three prompt types block the user without producing a detectable JSONL
 *  signal while they're pending: `AskUserQuestion` / `ExitPlanMode` (the Claude
 *  Agent SDK buffers the in-flight assistant message in memory and flushes it to
 *  the transcript only *after* the user answers, so `deriveState` reads the
 *  prior entry — `thinking` or `waiting`), and tool-permission gates
 *  (Write/Edit/Bash/WebFetch — the tool call IS on disk so the tail reads
 *  `tool_use`, but the approval decision is screen-only). All three are already
 *  painted on the terminal — so we recognize them on the rendered screen
 *  instead of waiting for JSONL that arrives too late or not at all.
 *
 *  This file is the Claude-specific *detector* + the promote-only *policy* that
 *  lifts the active pollable state → `awaiting_user` when a prompt is on
 *  screen. It is pure and
 *  stateless: a VT-resolved screen snapshot (and the JSONL-derived info) in, a
 *  decision out. Zero `node:*` imports, zero filesystem — the server's poller
 *  feeds it `getScreenText`; `screen.test.ts` feeds it fixtures. The
 *  `ClaudeCodeInfo` import is type-only (erased), so this stays as pure as
 *  `schemas.ts`.
 *
 *  ## Signature — framework-rendered markers (claude-code v2.1.162–v2.1.173, captured live)
 *  See `PROMPT_MARKERS` for the verbatim list and per-marker rationale. In short,
 *  three awaiting-user prompts are recognized, each by chrome no idle menu or
 *  ordinary output carries: `AskUserQuestion` (its `… to navigate … · Esc to cancel`
 *  footer (tolerating an intervening segment such as v2.1.173's `· n to add
 *  notes`), covering both the single-select and multi-select tabbed shapes), the
 *  edit-family permission gate (Write/Edit/NotebookEdit — its full
 *  `Esc to cancel · Tab to amend` footer), and the other permission gates
 *  (Bash/WebFetch/… — their numbered `<n>. Yes, and don't ask again for <x>`
 *  remember-option line). Each marker is anchored on the full surrounding chrome
 *  (whole footer / whole numbered option line), not a bare phrase, so the words
 *  alone in Bash output, a diff, or model prose can't false-promote. The
 *  look-alikes that share a word or two — `/model` and the trust prompt end in
 *  "Esc to cancel"; the `/fork` agent list says "to select" — are excluded the
 *  same way.
 *
 *  `ExitPlanMode` is still NOT detected — its dialog has no arrow footer
 *  (`Ready to code?` + `shift+tab to approve…`), so it needs a separate, more
 *  volatile string literal; a small high-confidence surface we grow over time
 *  beats a broad one that false-promotes, so it (and the hook-based path) remain
 *  follow-ups.
 *
 *  Bottom-region gate: the live prompt renders at the cursor (screen bottom), so
 *  matching is confined to the screen tail — a marker scrolled into history can't
 *  fire, and once the user answers, the JSONL advances and the poll disarms
 *  regardless of what lingers on screen.
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

/** Framework-rendered markers that prove an awaiting-user prompt is on screen.
 *  Each is verbatim chrome captured live (`tmux capture-pane`, claude-code
 *  v2.1.162) — not model-supplied option text — anchored on a phrase no idle
 *  menu or ordinary output carries. Any one present in the screen tail is proof.
 *
 *   1. **AskUserQuestion** — its footer pairing `… to navigate … · Esc to
 *      cancel` on one line. Keying on the co-occurrence (not the nav-hint glyphs)
 *      covers both shapes — single-select renders `↑/↓ to navigate`, the
 *      multi-select tabbed form renders `Tab/Arrow keys to navigate` — and
 *      tolerates a middle segment between the two halves: v2.1.173 inserted
 *      `· n to add notes` there, so the regex spans `to navigate` … `· Esc to
 *      cancel` rather than requiring them adjacent. The match stays on a single
 *      line (no `s` flag), and the `· Esc to cancel` suffix keeps it off prose
 *      ("…arrow keys to navigate the file tree") and the look-alikes that end in
 *      "Esc to cancel" but never carry "to navigate" on that line (`/model` →
 *      "session only · Esc to cancel"; trust → "Enter to confirm · Esc to
 *      cancel"; `/fork` list → "↑/↓ to select · Enter to view").
 *   2. **Edit-family permission gate** (Write / Edit / NotebookEdit) — the
 *      "Do you want to create/edit X?" approval, whose footer is
 *      `Esc to cancel · Tab to amend`. Anchored on the *whole footer* (both
 *      halves, `·` optional) rather than the bare `Tab to amend` words, so the
 *      phrase appearing alone in Bash output, a diff, or model prose can't fire —
 *      it's the framework footer pairing that's the signal.
 *   3. **Other permission gates** (Bash / WebFetch / …) — the "remember my
 *      choice" option line `<n>. Yes, and don't ask again for <x>`. These gates
 *      have no `Tab to amend` footer, so they need their own marker. Anchored on
 *      the full numbered option line (start-of-line `<n>. Yes, and don't ask
 *      again for`, apostrophe-agnostic) rather than the bare `don't ask again`
 *      words — that bare phrase is plausible English prose Claude might write or
 *      tool output might carry, but the numbered-option framing is chrome only
 *      the gate paints.
 *
 *  Permission gates fire while the tool call is on disk, so the session reads as
 *  `tool_use` (already pollable) — only the marker is new, not the state gate. */
const PROMPT_MARKERS: readonly RegExp[] = [
  /to navigate\b.*·\s*Esc to cancel/, // AskUserQuestion (single + multi-select; tolerates a middle footer segment, e.g. `· n to add notes`)
  /Esc to cancel\s*·?\s*Tab to amend/, // Write/Edit/NotebookEdit gate footer
  /^\s*\d+\.\s*Yes, and don.t ask again for\b/m, // Bash/WebFetch/etc. gate option
];

/** The last block of rendered lines, trailing blank rows trimmed so the "tail"
 *  is the last *painted* content, not the empty rows below a short prompt. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Whether an awaiting-user prompt (`AskUserQuestion` or a tool-permission gate)
 *  is painted on the rendered screen — any `PROMPT_MARKERS` entry in the tail. */
export function screenHasClaudePrompt(screenText: string): boolean {
  const tail = tailRegion(screenText).join("\n");
  return PROMPT_MARKERS.some((re) => re.test(tail));
}

// --- Promote-only policy (the seam the server poller drives) ---

/** States the screen scrape can lift to `awaiting_user`. Crucially this is NOT
 *  just `waiting`: a pending `AskUserQuestion` leaves the JSONL showing the state
 *  from *before* the buffered assistant reply, and in the common flow (the user
 *  types, the agent immediately asks) the newest on-disk entry is the user's
 *  prompt — so `deriveState` reports **`thinking`**, not `waiting` (gating to
 *  `waiting` alone is why the dock sat on "Thinking" with the prompt clearly on
 *  screen). `waiting` (a prior `end_turn`) and `tool_use` are possible too, so
 *  all three are pollable. `awaiting_user` is already lifted; `running_background`
 *  is a workflow busy-wait left alone. The poll still no-ops unless the prompt
 *  marker is actually on screen, so polling an in-flight `thinking` is cheap and
 *  can't false-promote. */
const PROMOTABLE_STATES = new Set<ClaudeCodeInfo["state"]>([
  "thinking",
  "tool_use",
  "waiting",
]);

/** Whether `info` is in a state the screen scrape could promote — the gate for
 *  the poll clock. */
export function isScreenPollable(info: ClaudeCodeInfo): boolean {
  return PROMOTABLE_STATES.has(info.state);
}

/** Merge the JSONL-derived `info` with a rendered-screen snapshot: lift the
 *  active pollable state (`thinking`/`tool_use`/`waiting`) → `awaiting_user` when
 *  any `PROMPT_MARKERS` entry (the `AskUserQuestion` footer or a tool-permission
 *  gate) is on screen, otherwise return `info` unchanged (same reference).
 *  Promote-only —
 *  it never lowers a state; a genuine state change flows back through the JSONL
 *  watcher. The returned reference identity is the "did anything change?" signal
 *  the poller checks. */
export function promoteFromScreen(
  info: ClaudeCodeInfo,
  screenText: string,
): ClaudeCodeInfo {
  if (!PROMOTABLE_STATES.has(info.state)) return info;
  return screenHasClaudePrompt(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
