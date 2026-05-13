/** Line-anchored inline composer — opens when the user clicks the
 *  "+" bubble next to a selected line, or the "💬" bubble next to a
 *  queued comment, or via the right-click "Add comment" menu, or via
 *  the tray pencil. Positioning is delegated to `@kolu/solid-pierre`'s
 *  `usePierreLineAnchor`; this component owns the composer UI plus the
 *  viewport-clamp on the right edge. */

import {
  deepQuerySelector,
  type SelectedLineRange,
  usePierreLineAnchor,
} from "@kolu/solid-pierre";
import { type Component, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { Comment } from "./commentSerialize";
import CommentComposer from "./CommentComposer";

/** Discriminated edit target — what the popover is currently editing. */
export type InlineEditTarget =
  | { kind: "new"; path: string; range: SelectedLineRange }
  | { kind: "edit"; comment: Comment };

export type InlineCommentPopoverProps = {
  viewerEl: () => HTMLElement | null;
  target: () => InlineEditTarget | null;
  onSubmit: (text: string) => void;
  onClose: () => void;
};

const POPOVER_WIDTH = 280;

const InlineCommentPopover: Component<InlineCommentPopoverProps> = (props) => {
  const pos = usePierreLineAnchor({
    viewerEl: props.viewerEl,
    resolveTarget: () => {
      const root = props.viewerEl();
      return root ? deepQuerySelector(root, "[data-selected-line]") : null;
    },
    active: () => props.target() !== null,
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
            : { start: t.range.start, end: t.range.end };
        const path = t.kind === "edit" ? t.comment.path : t.path;
        const initialText = t.kind === "edit" ? t.comment.text : "";
        // Clamp to viewport so a long line doesn't push past the right
        // edge. The clamp lives in the consumer (not the primitive)
        // because POPOVER_WIDTH is component-specific.
        const maxLeft = window.innerWidth - POPOVER_WIDTH - 12;
        const left = Math.min(p.rightEdge + 12, Math.max(maxLeft, 12));
        return (
          <Portal>
            <div
              style={{
                position: "fixed",
                left: `${left}px`,
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
