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
import {
  type Accessor,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
} from "solid-js";
import { walkShadowRoots } from "../dom/shadowWalk";
import { useCommentScrollRequest } from "./scrollRequest";
import type { Comment } from "./types";

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
  /** Which browse surface this overlay belongs to, when the file is
   *  multi-surface (Markdown's Source ⇄ Rendered). Since the keep-alive toggle
   *  now mounts BOTH surfaces at once, the overlay only owns the scroll request
   *  whose `surface` matches — otherwise the hidden/wrong surface, whose effect
   *  runs independently, could consume-and-clear a request meant for the other
   *  surface (a prose-only quote that doesn't exist in source, or vice versa),
   *  so the intended surface never scrolls. Undefined for single-surface views
   *  (plain source, diff) — those match a request with no surface. */
  surface?: Accessor<"source" | "prose" | undefined>;
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
  // no re-apply on toggle needed. The suffix is the instance's own stable
  // identity (`createUniqueId`), so the name is derived from the surface rather
  // than threaded through an external mutable counter.
  const name = `${COMMENT_HIGHLIGHT_NAME_PREFIX}-${createUniqueId()}`;
  const styleEl = document.createElement("style");
  styleEl.textContent = `::highlight(${name}) { ${COMMENT_HIGHLIGHT_STYLE_THEMED} }`;
  document.head.appendChild(styleEl);
  onCleanup(() => {
    window.CSS.highlights?.delete(name);
    styleEl.remove();
  });
  const scroll = useCommentScrollRequest();

  const applyCurrentHighlights = (
    host: HTMLElement,
    comments: Comment[],
  ): QuoteRoot => {
    const root = findHostRoot(host);
    applyHighlights(window, root, comments, name);
    return root;
  };

  // Mutation re-application is immediate, but keep a ticker for the separate
  // scroll-request path below: a prose DOM swap must still give a pending tray
  // jump another chance against the freshly-rendered nodes.
  const [domTick, setDomTick] = createSignal(0);

  // Watch the host subtree only for prose surfaces. Kept in its own effect so
  // it tracks `host` alone — the observer isn't torn down and rebuilt on a
  // comments/content re-apply.
  // `applyHighlights` uses the CSS Highlight API, which sets no DOM nodes, so
  // our own re-apply never re-triggers the observer.
  createEffect(() => {
    if (!opts.observeMutations) return;
    const host = opts.host();
    if (!host) return;
    // Apply directly from the observer callback. Routing through a signal and
    // another scheduled reactive pass left a second queueing window under
    // heavy load; the callback already runs at the browser's mutation
    // checkpoint and has the current comments accessor available.
    const observer = new MutationObserver(() => {
      applyCurrentHighlights(host, opts.comments());
      if (scroll.request()) setDomTick((n) => n + 1);
    });
    observer.observe(host, { childList: true, subtree: true });
    onCleanup(() => {
      observer.disconnect();
    });
  });

  createEffect(() => {
    const host = opts.host();
    const comments = opts.comments();
    opts.contentTick?.(); // dependency
    domTick(); // dependency — retry pending scroll work after a prose DOM swap
    if (!host) return;
    const root = applyCurrentHighlights(host, comments);

    // After the highlight set is applied for this file, consume any
    // pending scroll request. We resolve the target comment's range
    // fresh inside the rAF below (don't trust a stored Range across
    // renders — the DOM may have been replaced).
    const req = scroll.request();
    if (!req) return;
    // Only the overlay whose surface matches the request owns it. Both
    // Source ⇄ Rendered surfaces are kept alive now, so without this gate the
    // wrong surface could find-or-fail and `scroll.clear()` the request before
    // the intended surface — re-running after its own lazy Shiki/Markdown swap
    // — gets to scroll. `undefined === undefined` matches the
    // single-surface views (plain source, diff) against a surface-less request.
    if (req.surface !== opts.surface?.()) return;
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
