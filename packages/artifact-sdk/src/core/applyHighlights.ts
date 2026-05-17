/** Shared "re-find + register CSS Custom Highlights" pipeline. Used by
 *  both runtimes — the in-iframe SDK applies highlights inside the
 *  iframe document, the parent-side overlay applies them on Pierre's
 *  rendered DOM (descending through shadow roots when present).
 *
 *  Browser support: Chrome 105+, Safari 17.2+, Firefox 140+. The guard
 *  on `Highlight` + `CSS.highlights` here means older browsers degrade
 *  silently — comments still appear in the tray, just without in-place
 *  highlights. */

import type { Locator } from "../types";
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

export interface HighlightInputComment {
  id: string;
  locator: Locator;
}

/** Re-find each comment's quote in `root`'s text and register a single
 *  `Highlight` under `name`. Drops highlights when `comments` is empty
 *  or when none of the quotes resolve to a Range. */
export function applyHighlights(
  win: Window,
  root: Document | ShadowRoot,
  comments: HighlightInputComment[],
  name: string,
): void {
  const HighlightCtor = win.Highlight;
  if (!HighlightCtor || !win.CSS.highlights) return;
  if (comments.length === 0) {
    win.CSS.highlights.delete(name);
    return;
  }
  const text =
    root instanceof Document
      ? (root.body?.textContent ?? "")
      : (root.textContent ?? "");
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
