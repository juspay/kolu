/** Given a DOM Range, build a W3C-style TextQuoteSelector locator —
 *  the selected text plus ±32-char context windows on either side so
 *  duplicate quotes can be disambiguated on re-find.
 *
 *  Pure with respect to the Range/Document API surface; no DOM mutation.
 *  Used by both the parent-side `useTextSelection` and the in-iframe SDK
 *  (bundled by esbuild at server startup, served from the same source). */

import type { Locator } from "../types";

const CONTEXT_WINDOW = 32;

/** Concatenated text content of a Document or shadow root. Used as the
 *  haystack for prefix/suffix extraction. Pierre's open shadow DOM is
 *  walked transparently when the Range's commonAncestor lives inside it
 *  — `textContent` crosses shadow boundaries for ranges that span them. */
function rootTextContent(doc: Document | ShadowRoot): string {
  // `textContent` on a Document returns null; use body instead.
  if (doc instanceof Document) return doc.body?.textContent ?? "";
  return doc.textContent ?? "";
}

/** Return the character offset of `range.startContainer` (at `startOffset`)
 *  within the concatenated `rootTextContent(doc)`. Walks text nodes in
 *  document order and accumulates lengths until the start node is hit. */
function offsetOf(
  range: Range,
  doc: Document | ShadowRoot,
  which: "start" | "end",
): number {
  const target = which === "start" ? range.startContainer : range.endContainer;
  const targetOffset = which === "start" ? range.startOffset : range.endOffset;
  const root = doc instanceof Document ? (doc.body ?? doc) : doc;
  const ownerDoc = doc instanceof Document ? doc : doc.ownerDocument;
  if (!ownerDoc) return 0;
  const walker = ownerDoc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node === target) return acc + targetOffset;
    acc += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  // Range boundary not inside this root (e.g. cross-root selection) —
  // fall back to the accumulated total so the prefix is the full text
  // before. The locator still carries the quote, which is the durable
  // anchor; prefix/suffix is purely a disambiguator.
  return acc;
}

/** Build a Locator from a non-collapsed Range. Caller guarantees non-empty. */
export function extractQuote(
  range: Range,
  doc: Document | ShadowRoot,
): Locator {
  const quote = range.toString();
  const text = rootTextContent(doc);
  const start = offsetOf(range, doc, "start");
  const end = offsetOf(range, doc, "end");
  const prefix = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
  const suffix = text.slice(end, end + CONTEXT_WINDOW);
  return { quote, prefix, suffix };
}
