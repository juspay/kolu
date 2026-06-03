/** Re-find a Locator inside a body of text — return the [start, end]
 *  character offsets of the best match, or null when nothing plausible
 *  exists. Caller maps offsets back to a DOM Range via `rangeFromOffsets`.
 *
 *  Algorithm:
 *    1. Find all occurrences of `quote` in the haystack.
 *    2. If one match → return it.
 *    3. If multiple → score each by prefix+suffix similarity, take the best.
 *    4. If zero → null (anchor rot; caller surfaces the comment without
 *       a highlight). */

import type { Locator, QuoteRoot } from "../types";

export type QuoteMatch = { start: number; end: number };

function allOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return out;
    out.push(i);
    from = i + 1;
  }
}

/** Match-prefix-then-suffix scoring: longest common prefix of `expected`
 *  ending at offset, plus longest common suffix of `expected` starting
 *  at offset+quote.length. Higher is better; ties broken by which
 *  occurrence appears first in the haystack. */
function score(
  haystack: string,
  quoteEnd: number,
  expected: { prefix: string; suffix: string },
  occurrence: number,
): number {
  let prefixMatch = 0;
  const pe = expected.prefix;
  for (let i = 0; i < pe.length; i++) {
    const h = occurrence - 1 - i;
    const e = pe.length - 1 - i;
    if (h < 0) break;
    if (haystack[h] !== pe[e]) break;
    prefixMatch++;
  }
  let suffixMatch = 0;
  const se = expected.suffix;
  for (let i = 0; i < se.length; i++) {
    if (haystack[quoteEnd + i] !== se[i]) break;
    suffixMatch++;
  }
  return prefixMatch + suffixMatch;
}

export function findQuote(
  haystack: string,
  locator: Locator,
): QuoteMatch | null {
  const occurrences = allOccurrences(haystack, locator.quote);
  if (occurrences.length === 0) return null;
  const first = occurrences[0];
  if (first === undefined) return null;
  if (occurrences.length === 1) {
    return { start: first, end: first + locator.quote.length };
  }
  let best = first;
  let bestScore = score(
    haystack,
    first + locator.quote.length,
    { prefix: locator.prefix, suffix: locator.suffix },
    first,
  );
  for (let i = 1; i < occurrences.length; i++) {
    const start = occurrences[i];
    if (start === undefined) continue;
    const end = start + locator.quote.length;
    const s = score(
      haystack,
      end,
      { prefix: locator.prefix, suffix: locator.suffix },
      start,
    );
    if (s > bestScore) {
      bestScore = s;
      best = start;
    }
  }
  return { start: best, end: best + locator.quote.length };
}

/** Build a DOM Range that covers [start, end] character offsets inside a
 *  Document or shadow root. Returns null if the offsets can't be resolved
 *  to text-node boundaries (caller treats this as "anchor rotted"). */
export function rangeFromOffsets(
  doc: QuoteRoot,
  start: number,
  end: number,
): Range | null {
  const root = doc instanceof Document ? (doc.body ?? doc) : doc;
  const ownerDoc = doc instanceof Document ? doc : doc.ownerDocument;
  if (!ownerDoc) return null;
  const walker = ownerDoc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (startNode === null && acc + len > start) {
      startNode = node as Text;
      startNodeOffset = start - acc;
    }
    if (acc + len >= end) {
      endNode = node as Text;
      endNodeOffset = end - acc;
      break;
    }
    acc += len;
    node = walker.nextNode();
  }
  if (startNode === null || endNode === null) return null;
  const range = ownerDoc.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}
