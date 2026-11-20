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
import type { BrowseSurface, Comment } from "./types";

function findHostRoot(host: HTMLElement): QuoteRoot {
  return walkShadowRoots(host, (sr) => sr) ?? host;
}

export interface OverlayOptions {
  host: Accessor<HTMLElement | undefined>;
  comments: Accessor<Comment[]>;
  contentTick?: Accessor<string | undefined>;
  observeMutations?: boolean;
  surface?: Accessor<BrowseSurface | undefined>;
}

function trackReapplyTriggers(
  opts: OverlayOptions,
  domTick: Accessor<number>,
): void {
  opts.contentTick?.();
  domTick();
}

export function useHighlightOverlay(opts: OverlayOptions): void {
  if (!window.CSS?.highlights || !window.Highlight) return;
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

  const [domTick, setDomTick] = createSignal(0);

  createEffect(() => {
    if (!opts.observeMutations) return;
    const host = opts.host();
    if (!host) return;
    let queued = false;
    let disposed = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        applyCurrentHighlights(host, opts.comments());
        if (scroll.request()) setDomTick((n) => n + 1);
      });
    });
    observer.observe(host, { childList: true, subtree: true });
    onCleanup(() => {
      disposed = true;
      observer.disconnect();
    });
  });

  createEffect(() => {
    const host = opts.host();
    const comments = opts.comments();
    trackReapplyTriggers(opts, domTick);
    if (!host) return;
    const root = applyCurrentHighlights(host, comments);

    const req = scroll.request();
    if (!req) return;
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
