/** Line-anchored inline composer — opens when the user clicks the
 *  "+" bubble next to a selected line, or the "💬" bubble next to a
 *  queued comment, or via the right-click "Add comment" menu, or via
 *  the tray pencil. Pins to the line's `[data-selected-line]`
 *  element via `getBoundingClientRect`, re-measures on scroll/resize,
 *  portals to `<body>` so it isn't clipped by the viewer's
 *  `overflow: hidden`.
 *
 *  Pierre's diff renderer attaches an open shadow root to its
 *  `<diffs-container>` custom element, so the lookup walks shadow
 *  trees too (`deepQuerySelector`). */

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
import { deepQuerySelector } from "./LineCommentMarker";

/** Discriminated edit target — what the popover is currently editing. */
export type InlineEditTarget =
  | { kind: "new"; path: string; startLine: number; endLine: number }
  | { kind: "edit"; comment: Comment };

export type InlineCommentPopoverProps = {
  viewerEl: () => HTMLElement | null;
  target: () => InlineEditTarget | null;
  onSubmit: (text: string) => void;
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
    // Viewer hidden (right panel collapsed or inspector tab) → don't
    // orphan the popover over the canvas. Bail until viewer reappears.
    const vrect = root.getBoundingClientRect();
    if (vrect.width === 0 || vrect.height === 0) {
      setPos(null);
      return;
    }
    const sel = deepQuerySelector(root, "[data-selected-line]");
    if (!sel) {
      setPos(null);
      return;
    }
    // The selected `<code>` element fills the full grid row, so its
    // bounding rect.right is the viewer edge — useless for anchoring
    // "to the right of the line". A DOM Range over the content gives
    // a tight box around just the text.
    const lineRect = sel.getBoundingClientRect();
    // Pierre's tokenized inline content makes `Range.getBoundingClientRect`
    // unreliable (zero-width across browsers). Iterate child rects for
    // the rightmost edge — works for both grid-rendered diff lines and
    // plain file-view lines.
    let anchorRight = lineRect.left;
    for (const child of Array.from(sel.children)) {
      const r = (child as HTMLElement).getBoundingClientRect();
      if (r.right > anchorRight) anchorRight = r.right;
    }
    if (anchorRight === lineRect.left) anchorRight = lineRect.left + 8;
    // Hide when the line scrolled out (above OR below the viewer).
    if (lineRect.bottom < vrect.top || lineRect.top > vrect.bottom) {
      setPos(null);
      return;
    }
    // Clamp to viewport so a long line doesn't push past the right
    // edge. POPOVER_WIDTH matches CommentComposer's `w-[280px]`.
    const POPOVER_WIDTH = 280;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - 12;
    const left = Math.min(anchorRight + 12, Math.max(maxLeft, 12));
    setPos({ left, top: lineRect.top });
  };

  // Continuous rAF while open — Pierre virtualizes via
  // `transform: translateY`, which doesn't fire `scroll` events, so a
  // one-shot measure + scroll-listener combo misses transform-driven
  // reflows. One rect read per frame is cheap.
  createEffect(() => {
    props.target();
    let raf: number | undefined;
    const loop = () => {
      if (props.target() === null) {
        setPos(null);
        return;
      }
      measure();
      raf = requestAnimationFrame(loop);
    };
    loop();
    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf);
    });
  });

  return (
    <Show when={props.target() && pos()}>
      {(_) => {
        const t = props.target();
        const p = pos();
        if (!t || !p) return null;
        const range =
          t.kind === "edit"
            ? { start: t.comment.startLine, end: t.comment.endLine }
            : { start: t.startLine, end: t.endLine };
        const path = t.kind === "edit" ? t.comment.path : t.path;
        const initialText = t.kind === "edit" ? t.comment.text : "";
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
