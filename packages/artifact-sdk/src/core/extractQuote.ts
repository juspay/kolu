/** Given a DOM Range, build a W3C-style TextQuoteSelector locator —
 *  the selected text plus ±32-char context windows on either side so
 *  duplicate quotes can be disambiguated on re-find.
 *
 *  Pure with respect to the Range/Document API surface; no DOM mutation.
 *  Used by both the parent-side `useTextSelection` and the in-iframe SDK
 *  (bundled by esbuild at server startup, served from the same source). */

import type { Locator, QuoteRoot } from "../types";
import { extractOffsets } from "./extractOffsets";

const CONTEXT_WINDOW = 32;

/** Concatenated text content of a QuoteRoot (Document, ShadowRoot, or Element). Used as the
 *  haystack for prefix/suffix extraction. Pierre's open shadow DOM is
 *  walked transparently when the Range's commonAncestor lives inside it
 *  — `textContent` crosses shadow boundaries for ranges that span them.
 *
 *  Exported so `applyHighlights` and the parent-side highlight overlay
 *  can reuse the same extraction rather than inlining the same ternary. */
export function rootTextContent(doc: QuoteRoot): string {
  // `textContent` on a Document returns null; use body instead.
  if (doc instanceof Document) return doc.body?.textContent ?? "";
  return doc.textContent ?? "";
}

/** Build a Locator from a non-collapsed Range. Caller guarantees non-empty. */
export function extractQuote(range: Range, doc: QuoteRoot): Locator {
  const quote = range.toString();
  const offsets = extractOffsets(doc, range);
  if (!offsets) {
    // Cross-root range — neither boundary is reachable from the walked
    // root. The old code substituted the document's tail text as
    // prefix/suffix, which is misleading garbage (it has nothing to do
    // with the actual selection). Emit empty context — the quote is
    // the durable anchor and `findQuote` falls back to "first match"
    // gracefully when prefix/suffix don't help disambiguate.
    return { quote, prefix: "", suffix: "" };
  }
  const text = rootTextContent(doc);
  const prefix = text.slice(
    Math.max(0, offsets.start - CONTEXT_WINDOW),
    offsets.start,
  );
  const suffix = text.slice(offsets.end, offsets.end + CONTEXT_WINDOW);
  return { quote, prefix, suffix };
}
