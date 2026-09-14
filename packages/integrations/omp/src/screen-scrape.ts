/** Screen-scrape detection of omp's awaiting-user dialogs.
 *
 *  Two omp surfaces block the user while the transcript cannot show it — or
 *  shows it only as the tool call that is already running:
 *
 *   - **Tool approval** (`tools.approvalMode` `always-ask` / `write`, or a
 *     per-tool override) — `formatApprovalPrompt` renders a bordered dialog
 *     whose title is `Allow tool: <name>` and whose options are `Approve` /
 *     `Deny`. The transcript's tail reads `tool_use` throughout the wait, so
 *     without this the tile shows "running tools" while the agent is in fact
 *     blocked on a keystroke.
 *   - **The `ask` tool** (a question to the user, `ask.enabled` default true) —
 *     a bordered dialog titled `Ask` (or `Ask (30s)` when a timeout is armed)
 *     above the question and its options.
 *
 *  Both are already painted on the terminal — so we recognize them on the
 *  rendered screen instead. This file is the omp-specific *detector* plus the
 *  promote-only *policy* that lifts a pollable state → `awaiting_user` when a
 *  dialog is on screen. Pure and stateless: a VT-resolved screen snapshot (and
 *  the transcript-derived info) in, a decision out. Zero `node:*` imports, zero
 *  filesystem; `screen-scrape.test.ts` feeds it fixtures captured live from omp
 *  18.1.21 in a PTY.
 *
 *  ## Signature choices
 *
 *  Each marker is the dialog's **top-left box corner plus its title** —
 *  `╭─ Allow tool: ` and `╭─ Ask`. The border corner is chrome only a
 *  framework dialog paints, and it is shape-independent: the `ask` dialog's
 *  footer differs between its single-select and multi-select/navigated forms,
 *  while its title does not, so anchoring on the title covers every shape with
 *  one literal. Prose that merely says "Allow tool:" or "Ask" cannot match.
 *
 *  `Ask` also covers the timed variant, since the title renders as
 *  `Ask (30s)` — the `\b` after `Ask` admits the space that follows.
 *
 *  The corner literal is the DEFAULT theme's (`theme.boxRound`, `╭`). omp's
 *  `symbolPreset: ascii` renders `+-` corners, which these markers miss — a
 *  documented limitation (agent-detection.mdx): loosening the anchor to "any
 *  1–2 chars before the title" would let typed input prose like `> Ask me`
 *  promote a tile with no dialog on it. A false `awaiting_user` costs more
 *  than a missed one, so the corner stays literal.
 *
 *  Re-confirm both literals from a live capture (`tmux capture-pane`, the same
 *  VT-resolved text `readScreenText` returns) on any omp UI change — never from
 *  a guess. */

import type { OmpInfo } from "./schemas.ts";

/** How many lines of the screen tail the gate inspects. The dialog renders at
 *  the cursor (screen bottom); 40 lines comfortably covers the tallest option
 *  list plus its footer while excluding scrollback that could carry stale
 *  dialog-like text. */
export const TAIL_REGION_LINES = 40;

/** Framework-rendered markers that prove a blocking dialog is on screen. Each
 *  is the dialog's box corner + title, captured verbatim from a live omp
 *  18.1.21 in a 140×45 PTY. Any one present in the screen tail is proof. */
const PROMPT_MARKERS: readonly RegExp[] = [
  /^╭─ Allow tool: /m, // tool-approval dialog title
  /^╭─ Ask\b/m, // `ask` tool dialog title, plain or `Ask (30s)`
];

/** The last block of rendered lines, trailing blank rows trimmed so the "tail"
 *  is the last *painted* content, not the empty rows below a short dialog. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Whether a blocking dialog (tool approval or an `ask` question) is painted on
 *  the rendered screen — any `PROMPT_MARKERS` entry in the tail. */
export function screenHasOmpPrompt(screenText: string): boolean {
  const tail = tailRegion(screenText).join("\n");
  return PROMPT_MARKERS.some((re) => re.test(tail));
}

// --- Promote-only policy (the seam the orchestrator's poller drives) ---

/** States the screen scrape can lift to `awaiting_user`. omp opens a dialog
 *  from inside a tool call, so the transcript tail is `tool_use` for the whole
 *  wait; `thinking` is included for the window where the assistant record for
 *  that call has not been folded yet. Deliberately NOT `waiting` or
 *  `awaiting_user`: an idle omp has no dialog to promote, and the poll is gated
 *  on this predicate so a settled agent costs nothing. */
const PROMOTABLE_STATES = new Set<OmpInfo["state"]>(["thinking", "tool_use"]);

/** Whether `info` is in a state the screen scrape could promote — the gate for
 *  the poll clock. */
export function isOmpScreenPollable(info: OmpInfo): boolean {
  return PROMOTABLE_STATES.has(info.state);
}

/** Merge the transcript-derived `info` with a rendered-screen snapshot: lift
 *  the active pollable state → `awaiting_user` when a blocking dialog is on
 *  screen, otherwise return `info` unchanged (same reference). Promote-only —
 *  it never lowers a state; the orchestrator self-demotes once the dialog
 *  clears, because the watcher's change gate drops the structurally-identical
 *  settle-back. The orchestrator compares the result to the published info
 *  STRUCTURALLY (`isDeepStrictEqual`, `padi/terminalWorkspace/sensors.ts`), so
 *  returning the same reference is a convenience, not the change signal — a
 *  fresh-but-equal object would be published no more often than this one. */
export function promoteOmpFromScreen(
  info: OmpInfo,
  screenText: string,
): OmpInfo {
  if (!PROMOTABLE_STATES.has(info.state)) return info;
  return screenHasOmpPrompt(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
