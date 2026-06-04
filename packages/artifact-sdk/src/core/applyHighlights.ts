/** Shared "re-find + register CSS Custom Highlights" pipeline. Used by
 *  both runtimes — the in-iframe SDK applies highlights inside the
 *  iframe document, the parent-side overlay applies them on Pierre's
 *  rendered DOM (descending through shadow roots when present).
 *
 *  Browser support: Chrome 105+, Safari 17.2+, Firefox 140+. The guard
 *  on `Highlight` + `CSS.highlights` here means older browsers degrade
 *  silently — comments still appear in the tray, just without in-place
 *  highlights. */

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
 *  needs the locator — keep the input shape minimal so callers from
 *  other surfaces (e.g. the iframe-side render-highlights message)
 *  don't have to invent IDs they'll never use. */
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
