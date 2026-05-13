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
    // the currently-selected content element. When `target.kind === "edit"`
    // we rely on the caller having pushed Pierre's selection to the
    // comment's range first — otherwise the lookup misses and the
    // popover stays hidden until that happens.
    const sel = root.querySelector<HTMLElement>("[data-selected-line]");
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
        // Fallback position keeps the popover discoverable while
        // we're still racing Pierre's selection-DOM commit — better
        // visible-at-corner than invisible. Once pos() resolves the
        // popover snaps to its anchor.
        const p = pos() ?? { left: 16, top: 80 };
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
