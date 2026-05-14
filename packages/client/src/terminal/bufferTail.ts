/** Extract the last N meaningful lines from an xterm buffer as plain text.
 *
 *  Walks the buffer bottom-up, skipping lines whose only content is
 *  whitespace, Unicode box-drawing characters (U+2500–U+257F), or a
 *  lone `>` prompt indicator — those are the horizontal rules and
 *  input-box borders that TUIs stack around their prompt area, so a
 *  naive last-N-lines read returns pure chrome with no signal.
 *
 *  Limitation: TUIs in alt-screen mode (e.g. Claude Code, Codex) keep
 *  no scrollback for the alternate buffer — `buffer.active.length`
 *  equals `term.rows`. Once the visible alt-screen is exhausted, there
 *  is nothing further to walk back to, so the tail can come back empty
 *  even with a large `searchDepth`. Consumers should treat an empty
 *  result as "no useful preview available" and render accordingly. */

import type { Terminal as XTerm } from "@xterm/xterm";

const BOX_DRAWING_ONLY = /^[\s─-╿]+$/;
const LONE_PROMPT = /^\s*>\s*$/;
const DEFAULT_SEARCH_DEPTH = 80;

export function tailBuffer(
  xterm: XTerm,
  n: number,
  searchDepth: number = DEFAULT_SEARCH_DEPTH,
): string[] {
  const buf = xterm.buffer.active;
  const out: string[] = [];
  const start = Math.max(0, buf.length - searchDepth);
  for (let y = buf.length - 1; y >= start && out.length < n; y--) {
    const text = buf.getLine(y)?.translateToString(true) ?? "";
    if (text.trim().length === 0) continue;
    if (BOX_DRAWING_ONLY.test(text)) continue;
    if (LONE_PROMPT.test(text)) continue;
    out.push(text);
  }
  return out.reverse();
}
