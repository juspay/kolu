/** Given a DOM Range, build a W3C-style TextQuoteSelector locator —
 *  the selected text plus ±32-char context windows on either side so
 *  duplicate quotes can be disambiguated on re-find.
 *
 *  Pure with respect to the Range/Document API surface; no DOM mutation.
 *  Used by both the parent-side `useTextSelection` and the in-iframe SDK
 *  (bundled by esbuild at server startup, served from the same source). */

import { extractOffsets } from "./extractOffsets";
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

/** Build a Locator from a non-collapsed Range. Caller guarantees non-empty. */
export function extractQuote(
  range: Range,
  doc: Document | ShadowRoot,
): Locator {
  const quote = range.toString();
  const text = rootTextContent(doc);
  // Cross-root ranges: fall back to the full text length as the offset
  // so the prefix slice ends at the document end. The locator still
  // carries the quote, which is the durable anchor; prefix/suffix is
  // purely a disambiguator. (Fact-check follow-up may tighten this.)
  const offsets = extractOffsets(doc, range) ?? {
    start: text.length,
    end: text.length,
  };
  const prefix = text.slice(
    Math.max(0, offsets.start - CONTEXT_WINDOW),
    offsets.start,
  );
  const suffix = text.slice(offsets.end, offsets.end + CONTEXT_WINDOW);
  return { quote, prefix, suffix };
}
