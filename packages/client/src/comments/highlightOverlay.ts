/** Parent-side overlay that highlights existing comments in-place on the
 *  currently-displayed file. Delegates the re-find + register work to
 *  `applyHighlights` in `@kolu/artifact-sdk/client` — the SAME function
 *  the in-iframe SDK uses — so the behavior is bit-identical across
 *  surfaces.
 *
 *  Browser support: Chrome 105+, Safari 17.2+, Firefox 140+. On older
 *  browsers, comments still appear in the tray; the in-place highlight
 *  silently degrades to nothing (the core function's `Highlight` guard
 *  short-circuits). */

import {
  applyHighlights,
  COMMENT_HIGHLIGHT_STYLE_THEMED,
  findQuote,
  rangeFromOffsets,
} from "@kolu/artifact-sdk/client";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { useCommentScrollRequest } from "./scrollRequest";
import type { Comment } from "./types";

const HIGHLIGHT_NAME = "kolu-comment";
const STYLE_ELEMENT_ID = "kolu-comment-highlight-style";

function ensureStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { ${COMMENT_HIGHLIGHT_STYLE_THEMED} }`;
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
  const scroll = useCommentScrollRequest();

  createEffect(() => {
    const host = opts.host();
    const comments = opts.comments();
    opts.contentTick?.(); // dependency
    if (!host) return;
    const root = findHostRoot(host);
    applyHighlights(window, root, comments, HIGHLIGHT_NAME);

    // After the highlight set is applied for this file, consume any
    // pending scroll request. We resolve the target comment's range
    // fresh (don't trust a stored Range across renders — the DOM may
    // have been replaced) and scroll it into view.
    const req = scroll.request();
    if (!req) return;
    const target = comments.find((c) => c.id === req.commentId);
    if (!target) return;
    const text =
      root instanceof Document
        ? (root.body?.textContent ?? "")
        : (root.textContent ?? "");
    const match = findQuote(text, target.locator);
    if (!match) {
      scroll.clear();
      return;
    }
    const range = rangeFromOffsets(root, match.start, match.end);
    if (!range) {
      scroll.clear();
      return;
    }
    // Wait for the next frame so Pierre's virtualizer has settled into
    // the new file's layout — scrolling on the same tick as render
    // sometimes lands on a stale node and the highlight ends up off-
    // screen.
    requestAnimationFrame(() => {
      const startContainer = range.startContainer;
      const el =
        startContainer.nodeType === Node.ELEMENT_NODE
          ? (startContainer as Element)
          : startContainer.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      scroll.clear();
    });
  });

  onCleanup(() => {
    window.CSS.highlights?.delete(HIGHLIGHT_NAME);
  });
}
