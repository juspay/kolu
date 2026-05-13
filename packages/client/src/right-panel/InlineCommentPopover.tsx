/** Line-anchored inline composer — the "click line → type here" surface.
 *
 *  Mounts when `target` is non-null (either a fresh selection in
 *  comment mode, or an edit invocation from the tray). Pins itself to
 *  the line's `[data-selected-line]` element via `getBoundingClientRect`,
 *  re-measures on scroll/resize, and portals to `<body>` so it isn't
 *  clipped by the viewer's `overflow: hidden`.
 *
 *  Why not Pierre's native annotation API: that takes `string[]`, not
 *  interactive elements. Pinning to the rendered line element is the
 *  closest we get to GitHub-PR inline composition without forking
 *  Pierre. The trade-off is that scrolling the line off-screen unmounts
 *  the popover — acceptable because the tray retains an edit affordance
 *  for any comment regardless of scroll position. */

import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { Comment } from "./commentSerialize";
import CommentComposer from "./CommentComposer";

/** Discriminated edit target — what the popover is currently editing. */
export type InlineEditTarget =
  | { kind: "new"; path: string; startLine: number; endLine: number }
  | { kind: "edit"; comment: Comment };

export type InlineCommentPopoverProps = {
  /** Live accessor for the viewer's scroll-root element. Used to find
   *  the selected line via `querySelector("[data-selected-line]")` — that
   *  attribute is Pierre's signal for the currently-selected content
   *  row (`InteractionManager.js` sets it after `setSelection`). */
  viewerEl: () => HTMLElement | null;
  /** Current edit target, or null when the popover should be hidden. */
  target: () => InlineEditTarget | null;
  /** Submit handler — receives the trimmed text. Caller dispatches to
   *  `addComment`/`updateComment` based on `target().kind`. */
  onSubmit: (text: string) => void;
  /** Close handler — fires on Esc, outside-click, empty-submit, or when
   *  the anchor element disappears. */
  onClose: () => void;
};

const InlineCommentPopover: Component<InlineCommentPopoverProps> = (props) => {
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(
    null,
  );
  // Last pointerdown coords inside the viewer — used as the anchor
  // when the shadow-DOM lookup misses (e.g. right-click context-menu
  // path that doesn't commit a Pierre selection). Captured in
  // viewport coords so it composes with `position: fixed` directly.
  // Tracked on the viewer's host so menu-item clicks (rendered as a
  // portal outside the viewer) don't poison it.
  const [lastClick, setLastClick] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  createEffect(() => {
    const root = props.viewerEl();
    if (!root) return;
    const onDown = (e: PointerEvent) =>
      setLastClick({ x: e.clientX, y: e.clientY });
    root.addEventListener("pointerdown", onDown);
    onCleanup(() => root.removeEventListener("pointerdown", onDown));
  });

  // Pierre's diff renderer attaches a shadow root to its
  // `<diffs-container>` custom element (`attachShadow({ mode: "open" })`
  // in `@pierre/diffs/components/web-components.js`), so a plain
  // `querySelector` from outside doesn't reach `[data-selected-line]`.
  // Walk all descendants and peek into any open shadow root we find;
  // returns the first match. Pierre uses open shadow, so this is safe.
  const deepQuerySelector = (
    root: HTMLElement | ShadowRoot,
    selector: string,
  ): HTMLElement | null => {
    const direct = root.querySelector<HTMLElement>(selector);
    if (direct) return direct;
    const hosts = root.querySelectorAll<HTMLElement>("*");
    for (const host of hosts) {
      const sr = host.shadowRoot;
      if (!sr) continue;
      const found = deepQuerySelector(sr, selector);
      if (found) return found;
    }
    return null;
  };

  const measure = () => {
    if (props.target() === null) {
      setPos(null);
      return;
    }
    const root = props.viewerEl();
    if (!root) {
      setPos(null);
      return;
    }
    // `[data-selected-line]` is set by Pierre's InteractionManager on
    // the currently-selected content element. In browse mode the
    // attribute lives directly under the viewer; in diff mode it's
    // inside `<diffs-container>`'s shadow root — `deepQuerySelector`
    // handles both. When `target.kind === "edit"` we rely on the
    // caller having pushed Pierre's selection to the comment's range
    // first — otherwise the lookup misses and the popover falls back
    // to the viewer corner until selection lands.
    const sel = deepQuerySelector(root, "[data-selected-line]");
    if (!sel) {
      setPos(null);
      return;
    }
    const r = sel.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4 });
  };

  // Re-measure on target change. Pierre commits its selection DOM via
  // `requestAnimationFrame` (`InteractionManager.renderSelection` queues
  // the mutation), so a synchronous measure right after `setEditTarget`
  // races that frame and finds no `[data-selected-line]`. Retry across
  // a handful of frames until the anchor lands (or target clears).
  createEffect(() => {
    props.target();
    let tries = 0;
    const attempt = () => {
      if (props.target() === null) return;
      measure();
      if (pos() !== null) return;
      if (tries++ > 10) return;
      requestAnimationFrame(attempt);
    };
    attempt();
  });

  // Re-measure on any scroll (capture-phase so nested scroll containers
  // — like the Virtualizer's overflow-auto div — also trigger us) and
  // on window resize. Cheaper than a continuous rAF loop; the rect read
  // only fires when the user is actually scrolling.
  const onScroll = () => measure();
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  onCleanup(() => {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
  });

  return (
    <Show when={props.target()}>
      {(_) => {
        const t = props.target();
        if (!t) return null;
        const range =
          t.kind === "edit"
            ? { start: t.comment.startLine, end: t.comment.endLine }
            : { start: t.startLine, end: t.endLine };
        const path = t.kind === "edit" ? t.comment.path : t.path;
        const initialText = t.kind === "edit" ? t.comment.text : "";
        // Anchor priority: resolved line rect (the proper inline
        // anchor) → last viewer pointerdown (good for both left-click
        // selection and right-click → context-menu paths, since the
        // menu portal lives outside the viewer and doesn't overwrite
        // `lastClick`) → nothing (don't dump the popover at the page
        // corner). The last-click fallback lands the popover right
        // where the mouse just was, so the user never has to chase it.
        const click = lastClick();
        const p = pos() ?? (click ? { left: click.x, top: click.y + 8 } : null);
        if (!p) return null;
        return (
          <Portal>
            <div
              style={{
                position: "fixed",
                left: `${p.left}px`,
                top: `${p.top}px`,
                "z-index": "50",
              }}
              data-testid="inline-comment-popover"
            >
              <CommentComposer
                path={path}
                startLine={range.start}
                endLine={range.end}
                initialText={initialText}
                onSubmit={props.onSubmit}
                onCancel={props.onClose}
              />
            </div>
          </Portal>
        );
      }}
    </Show>
  );
};

export default InlineCommentPopover;
