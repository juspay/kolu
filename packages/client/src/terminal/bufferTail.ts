/** Extract the last N meaningful lines from an xterm buffer as plain text.
 *
 *  Walks the buffer bottom-up, skipping lines that are pure TUI chrome:
 *  - Empty / whitespace-only
 *  - Unicode box-drawing (U+2500–U+257F) rules
 *  - Lone prompt indicators (`>` / `»` / `·` / `•` / `›` / `⏵` …),
 *    possibly preceded by other decoration
 *  - Claude Code's `» bypass permissions on (shift+tab …)` hint
 *  - Claude Code's thinking-timer chatter ("* Cooked for 10m 16s",
 *    "* Cogitated for 4s", and the rest of its rotating verb table)
 *
 *  Detection strips leading decorative glyphs first, then matches
 *  against the content phrase — so the prefix character can be
 *  ASCII `*`, the fancy `✱`, `⏺`, a box-drawing edge, or anything in
 *  the strip set without breaking the pattern.
 *
 *  Limitation: TUIs in alt-screen mode keep no scrollback on the
 *  alternate buffer (`buffer.alternate.length === rows`). Once the
 *  visible alt-screen is exhausted there is nothing further to walk
 *  back to — even at maximum `searchDepth` — so the tail can come
 *  back empty. Consumers should treat an empty result as "no useful
 *  preview available" and render accordingly. */

import type { Terminal as XTerm } from "@xterm/xterm";

const STRIP_LEADING_CHROME = /^[\s─-╿*✱⏺•·⏵»>›\-=*~]+/;
const CLAUDE_HINT = /^bypass permissions on/i;
/** Claude Code's thinking-timer chatter — any capitalized verb in past
 *  tense (-ed) or gerund (-ing) form followed by ` for <duration>`.
 *  Generalized from the enumerated verb list because Claude's vocab
 *  rotates (Cooked / Cogitated / Baked / Churned / Pondered / …) and
 *  the explicit list was already lagging two new ones at the time of
 *  the last addition. */
const CLAUDE_TIMER = /^[A-Z][a-z]+(ed|ing) for \d/;
/** Agency-tool recap marker line ("* recap: …"). The text after the
 *  marker is the actual recap content, which we want to see — only
 *  the marker line itself is chrome. */
const CLAUDE_RECAP = /^recap:/;

const DEFAULT_SEARCH_DEPTH = 120;

function isChrome(text: string): boolean {
  const stripped = text.replace(STRIP_LEADING_CHROME, "").trim();
  if (stripped.length === 0) return true;
  if (CLAUDE_HINT.test(stripped)) return true;
  if (CLAUDE_TIMER.test(stripped)) return true;
  if (CLAUDE_RECAP.test(stripped)) return true;
  return false;
}

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
    if (isChrome(text)) continue;
    out.push(text);
  }
  return out.reverse();
}
