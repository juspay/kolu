/** Parent-side overlay that highlights existing comments in-place on the
 *  currently-displayed file. Uses the CSS Custom Highlight API — no DOM
 *  mutation, doesn't interfere with Pierre's selection layer.
 *
 *  Browser support: Chrome 105+, Safari 17.2+, Firefox 140+. On older
 *  browsers, comments still appear in the tray; the in-place highlight
 *  silently degrades to nothing. */

import { createEffect, onCleanup, type Accessor } from "solid-js";
import {
  COMMENT_HIGHLIGHT_STYLE,
  findQuote,
  rangeFromOffsets,
} from "@kolu/artifact-sdk/client";
import type { Comment } from "./types";

const HIGHLIGHT_NAME = "kolu-comment";
const STYLE_ELEMENT_ID = "kolu-comment-highlight-style";

declare global {
  interface Window {
    Highlight?: new (...ranges: Range[]) => unknown;
    CSS: {
      highlights?: Map<string, unknown> & {
        set(name: string, highlight: unknown): void;
        delete(name: string): void;
      };
    };
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { ${COMMENT_HIGHLIGHT_STYLE} }`;
  document.head.appendChild(style);
}

/** Walk a host element + its shadow roots (Pierre's `<diffs-container>`
 *  attaches one) and return the concatenated text plus a function that
 *  resolves [start, end] offsets into a Range over the same text. */
function findHostRoot(host: HTMLElement): Document | ShadowRoot {
  // Pierre's vanilla file path renders directly into the wrapper; the
  // virtualized path nests a `<diffs-container>` custom element with
  // its own shadow root. Walk descendants to find a shadow root if any.
  const stack: Element[] = [host];
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) continue;
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) return sr;
    for (const child of Array.from(el.children)) stack.push(child);
  }
  return host.ownerDocument ?? document;
}

export interface OverlayOptions {
  host: Accessor<HTMLElement | undefined>;
  comments: Accessor<Comment[]>;
  /** Re-run on this ticker — caller bumps when the host's text content
   *  changed (file swap, content stream tick). The overlay re-finds the
   *  ranges since stored Ranges would point at stale text nodes. */
  contentTick?: Accessor<unknown>;
}

export function useHighlightOverlay(opts: OverlayOptions): void {
  if (!window.CSS?.highlights || !window.Highlight) return; // unsupported
  ensureStyle();

  createEffect(() => {
    const host = opts.host();
    const comments = opts.comments();
    opts.contentTick?.(); // dependency
    if (!host || comments.length === 0) {
      window.CSS.highlights?.delete(HIGHLIGHT_NAME);
      return;
    }
    const root = findHostRoot(host);
    const text =
      root instanceof Document
        ? (root.body?.textContent ?? "")
        : (root.textContent ?? "");
    const ranges: Range[] = [];
    for (const c of comments) {
      const match = findQuote(text, c.locator);
      if (!match) continue;
      const r = rangeFromOffsets(root, match.start, match.end);
      if (r) ranges.push(r);
    }
    if (ranges.length === 0) {
      window.CSS.highlights?.delete(HIGHLIGHT_NAME);
      return;
    }
    const HighlightCtor = window.Highlight;
    if (!HighlightCtor) return;
    window.CSS.highlights?.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  });

  onCleanup(() => {
    window.CSS.highlights?.delete(HIGHLIGHT_NAME);
  });
}
