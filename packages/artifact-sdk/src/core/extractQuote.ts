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
