/** Pure send-planning for the Inspector's Compose box — turn a drafted string
 *  into the exact bytes written to the terminal's PTY, with no I/O so the whole
 *  decision is unit-testable without an xterm/DOM harness (the same split
 *  `kaval-tui`'s `send.ts` keeps between `planSend` and the wire executor).
 *
 *  This is the in-app analog of `kaval-tui send`, and it honors the SAME
 *  "honest send" contract: it writes EXACTLY the drafted text and NEVER
 *  synthesizes a submit Enter. Submitting a prompt against a bracketed-paste
 *  TUI (Claude Code, Codex, opencode) races the TUI's paste debounce when the
 *  Enter rides in the same breath as the text, so the draft lands in the
 *  agent's input box and the user presses Enter there themselves — see
 *  `packages/kaval-tui/src/send.ts` for the full rationale behind that split.
 *
 *  The one transformation applied is BRACKETED PASTE for multiline text: the
 *  agent's input box takes it as ONE block instead of submitting line-by-line
 *  (each `\n` would otherwise fire a half-written prompt). Single-line text is
 *  written verbatim, matching `kaval-tui send`'s auto-paste rule. The markers
 *  come from `@kolu/terminal-protocol` — the one source of truth the CLI, the
 *  rich client's own paste path, and the mobile key bar all share. */

import { wrapBracketedPaste } from "@kolu/terminal-protocol";

/** Plan the single PTY write for a composed draft, or `null` when there's
 *  nothing to send (an empty or whitespace-only draft — a 0-byte write is a
 *  no-op, so the caller must not issue it, exactly as `planSend` refuses an
 *  empty payload). Multiline drafts are bracketed so they arrive as one block;
 *  single-line drafts are written verbatim. The draft is sent as-typed (no
 *  trimming of interior/edge whitespace) — WYSIWYG with the box — beyond the
 *  whitespace-only guard. */
export function planComposeSend(text: string): string | null {
  if (text.trim().length === 0) return null;
  return text.includes("\n") ? wrapBracketedPaste(text) : text;
}
