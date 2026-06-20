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
  COMMENT_HIGHLIGHT_NAME_PREFIX,
  COMMENT_HIGHLIGHT_STYLE_THEMED,
  findQuote,
  type QuoteRoot,
  rangeFromOffsets,
  rootTextContent,
} from "@kolu/artifact-sdk/client";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { useCommentScrollRequest } from "./scrollRequest";
import { walkShadowRoots } from "../dom/shadowWalk";
import type { Comment } from "./types";

// A monotonic suffix so each overlay instance owns a distinct CSS highlight
// name (see the per-instance rationale in `useHighlightOverlay`).
let highlightSeq = 0;

/** Resolve the root the highlight overlay should walk for re-find +
 *  Range construction. Pierre's virtualized path nests a `<diffs-container>`
 *  custom element with its own shadow root, so we descend through any shadow
 *  trees and return the first one found. Otherwise — a light-DOM surface like
 *  the rendered Markdown preview — fall back to the host element itself, so
 *  the re-find haystack is the view's subtree, not the whole app page (which
 *  must match the root `useTextSelection` anchored the quote against). */
function findHostRoot(host: HTMLElement): QuoteRoot {
  return walkShadowRoots(host, (sr) => sr) ?? host;
}

export interface OverlayOptions {
  host: Accessor<HTMLElement | undefined>;
  comments: Accessor<Comment[]>;
  /** Re-run on this ticker — caller bumps when the host's text content
   *  changed (file swap, content stream tick). The overlay re-finds the
   *  ranges since stored Ranges would point at stale text nodes. */
  contentTick?: Accessor<unknown>;
  /** When true, watch the host subtree for DOM replacement and re-apply the
   *  highlights when it changes. Set for the rendered Markdown preview, whose
   *  renderer reassigns `innerHTML` *after* mount — Shiki warms lazily and the
   *  `html` memo re-runs, swapping every text node. `contentTick` (the source
   *  string) doesn't move on that swap, so any CSS Highlight ranges applied
   *  beforehand would point at detached nodes and silently vanish. Off for the
   *  source / diff surfaces: Pierre's virtualizer churns its subtree on every
   *  scroll, and a MutationObserver there would thrash — those re-finds ride
   *  `contentTick` + the scroll-request rAF instead. */
  observeMutations?: boolean;
}

export function useHighlightOverlay(opts: OverlayOptions): void {
  if (!window.CSS?.highlights || !window.Highlight) return; // unsupported
  // A per-INSTANCE highlight name + style element. The CSS Custom Highlight
  // registry is one global map keyed by name, and `applyHighlights` *replaces*
  // the named highlight on each call — so two text surfaces mounted at once (the
  // Source ⇄ Rendered toggle now keeps both alive) sharing one name would
  // clobber each other's ranges, blanking the visible surface. A name per
  // instance lets each own its ranges independently; a hidden surface's ranges
  // just don't lay out, and the browser repaints them when it's shown again —
  // no re-apply on toggle needed.
  highlightSeq += 1;
  const name = `${COMMENT_HIGHLIGHT_NAME_PREFIX}-${highlightSeq}`;
  const styleEl = document.createElement("style");
  styleEl.textContent = `::highlight(${name}) { ${COMMENT_HIGHLIGHT_STYLE_THEMED} }`;
  document.head.appendChild(styleEl);
  onCleanup(() => {
    window.CSS.highlights?.delete(name);
    styleEl.remove();
  });
  const scroll = useCommentScrollRequest();

  // A subtree-mutation ticker for `observeMutations` surfaces (see the option
  // doc): each batch of host DOM mutations bumps it, re-running the apply
  // effect so highlights re-anchor onto the renderer's freshly-minted nodes.
  const [domTick, setDomTick] = createSignal(0);

  // Watch the host subtree only for prose surfaces. Kept in its own effect so
  // it tracks `host` alone — the observer isn't torn down and rebuilt on every
  // `domTick`/content re-apply (and `applyHighlights` uses the CSS Highlight
  // API, which sets no DOM nodes, so our own re-apply never re-triggers it).
  createEffect(() => {
    if (!opts.observeMutations) return;
    const host = opts.host();
    if (!host) return;
    // rAF-coalesced so a burst of mutations (a full innerHTML swap) bumps the
    // ticker once rather than per-record.
    let raf = 0;
    const observer = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setDomTick((n) => n + 1);
      });
    });
    observer.observe(host, { childList: true, subtree: true });
    onCleanup(() => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    });
  });

  createEffect(() => {
    const host = opts.host();
    const comments = opts.comments();
    opts.contentTick?.(); // dependency
    domTick(); // dependency — re-apply after the prose renderer swaps its DOM
    if (!host) return;
    const root = findHostRoot(host);
    applyHighlights(window, root, comments, name);

    // After the highlight set is applied for this file, consume any
    // pending scroll request. We resolve the target comment's range
    // fresh inside the rAF below (don't trust a stored Range across
    // renders — the DOM may have been replaced).
    const req = scroll.request();
    if (!req) return;
    const target = comments.find((c) => c.id === req.commentId);
    if (!target) return;
    const text = rootTextContent(root);
    const match = findQuote(text, target.locator);
    if (!match) {
      scroll.clear();
      return;
    }
    // Wait for the next frame so Pierre's virtualizer has settled into
    // the new file's layout — scrolling on the same tick as render
    // sometimes lands on a stale node and the highlight ends up off-
    // screen. The Range we resolved above will be invalidated by the
    // virtualizer churn we're waiting through, so re-resolve inside
    // the rAF body with the same offsets and bail silently if the
    // anchor moved out of the DOM during virtualization.
    requestAnimationFrame(() => {
      const fresh = rangeFromOffsets(root, match.start, match.end);
      if (!fresh) {
        scroll.clear();
        return;
      }
      const startContainer = fresh.startContainer;
      const el =
        startContainer.nodeType === Node.ELEMENT_NODE
          ? (startContainer as Element)
          : startContainer.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      scroll.clear();
    });
  });
}
