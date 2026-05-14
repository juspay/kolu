/** Extract the last N meaningful lines from an xterm buffer as plain text.
 *
 *  Walks the buffer bottom-up, skipping lines that match any "chrome"
 *  pattern: empty/whitespace-only, Unicode box-drawing (U+2500–U+257F)
 *  rules that bracket TUI input boxes, lone prompt indicators (`>` /
 *  `»` / `·` / `•`), Claude Code's `»` hint lines ("bypass permissions
 *  on …"), and Claude Code's thinking-timer chatter ("* Cooked for
 *  10m 16s", "* Cogitated for 4s"). Whatever remains is the most
 *  recent assistant prose / tool-call output.
 *
 *  Why hard-coded Claude patterns: Claude's TUI redraws the bottom of
 *  its alt-screen with these markers every render, so without skipping
 *  them the tail returns thinking-state chrome that the user already
 *  sees on the underlying tile. The alternative — agent-specific
 *  extraction paths threaded through callers — is exactly the
 *  complexity this approach was meant to avoid. When more agents
 *  emit similarly-shaped chrome, extend the regexes here.
 *
 *  Limitation: TUIs in alt-screen mode keep no scrollback on the
 *  alternate buffer (`buffer.alternate.length === rows`). Once the
 *  visible alt-screen is exhausted, there is nothing further to walk
 *  back to — even at maximum `searchDepth` — so the tail can come
 *  back empty. Consumers should treat an empty result as "no useful
 *  preview available" and render accordingly. */

import type { Terminal as XTerm } from "@xterm/xterm";

const BOX_DRAWING_ONLY = /^[\s─-╿]+$/;
const LONE_PROMPT = /^\s*[>»·•]\s*$/;
const CLAUDE_HINT = /^\s*»/;
const CLAUDE_TIMER =
  /^\s*\*\s+(Cooked|Cogitated|Tinkering|Pondering|Ruminating|Brewing|Hatching|Conjuring|Smoldering|Stewing|Working|Crunching|Forging|Thinking|Musing|Reasoning|Deliberating|Contemplating|Synthesizing|Processing) for /;

const DEFAULT_SEARCH_DEPTH = 80;

function isChrome(text: string): boolean {
  if (text.trim().length === 0) return true;
  if (BOX_DRAWING_ONLY.test(text)) return true;
  if (LONE_PROMPT.test(text)) return true;
  if (CLAUDE_HINT.test(text)) return true;
  if (CLAUDE_TIMER.test(text)) return true;
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
