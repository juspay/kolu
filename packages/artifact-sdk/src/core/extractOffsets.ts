import type { QuoteRoot } from "../types";

/** Compute character offsets of a Range's start and end within the
 *  concatenated text content of a QuoteRoot (Document, ShadowRoot, or
 *  Element).
 *
 *  Returns `undefined` when either boundary container isn't reachable
 *  from the root — i.e. cross-root selections. Callers should treat
 *  that as "anchor can't be resolved" rather than substituting a
 *  guessed offset, which would produce misleading prefix/suffix
 *  context. */
export function extractOffsets(
  root: QuoteRoot,
  range: Range,
): { start: number; end: number } | undefined {
  const rootEl =
    root instanceof Document ? (root.body ?? root) : (root as Node);
  const ownerDoc = root instanceof Document ? root : root.ownerDocument;
  if (!ownerDoc) return undefined;
  const walker = ownerDoc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startOff = -1;
  let endOff = -1;
  let node: Node | null = walker.nextNode();
  while (node) {
    if (startOff < 0 && node === range.startContainer) {
      startOff = acc + range.startOffset;
    }
    if (node === range.endContainer) {
      endOff = acc + range.endOffset;
      break;
    }
    acc += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  if (startOff < 0 || endOff < 0) return undefined;
  return { start: startOff, end: endOff };
}
