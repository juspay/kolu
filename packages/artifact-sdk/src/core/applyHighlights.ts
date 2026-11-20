import type { Locator, QuoteRoot } from "../types";
import { rootTextContent } from "./extractQuote";
import { findQuote, rangeFromOffsets } from "./findQuote";

declare global {
  interface Window {
    Highlight?: new (...ranges: Range[]) => unknown;
    CSS: {
      highlights?: {
        set(name: string, highlight: unknown): void;
        delete(name: string): void;
      };
    };
  }
}

/** What `applyHighlights` reads off each comment. `Comment`s carry more
 *  fields (id, body, createdAt, …) but the highlight pipeline only
 *  needs the locator. */
export interface HighlightInputComment {
  locator: Locator;
}

/** Re-find each comment's quote in `root`'s text and register a single
 *  `Highlight` under `name`. Drops highlights when `comments` is empty
 *  or when none of the quotes resolve to a Range. */
export function applyHighlights(
  win: Window,
  root: QuoteRoot,
  comments: HighlightInputComment[],
  name: string,
): void {
  const HighlightCtor = win.Highlight;
  if (!HighlightCtor || !win.CSS.highlights) return;
  if (comments.length === 0) {
    win.CSS.highlights.delete(name);
    return;
  }
  const text = rootTextContent(root);
  const ranges: Range[] = [];
  for (const c of comments) {
    const match = findQuote(text, c.locator);
    if (!match) continue;
    const range = rangeFromOffsets(root, match.start, match.end);
    if (range) ranges.push(range);
  }
  if (ranges.length === 0) {
    win.CSS.highlights.delete(name);
    return;
  }
  win.CSS.highlights.set(name, new HighlightCtor(...ranges));
}
