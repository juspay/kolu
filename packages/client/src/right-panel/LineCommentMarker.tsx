/** A tiny floating button anchored to the right side of a code line.
 *  Two roles, one component:
 *    - "+" on the currently-selected line → click opens a fresh
 *      composer (the user-confirmed click that replaces the old
 *      auto-popover-on-select).
 *    - "💬" on lines that carry a queued comment → click re-opens
 *      the composer in edit mode at that comment.
 *
 *  Positioning is delegated to `@kolu/solid-pierre`'s
 *  `usePierreLineAnchor` primitive (handles the rAF loop, shadow-DOM
 *  traversal, and child-rect math). This component only owns the
 *  glyph + click behavior. */

import { usePierreLineAnchor } from "@kolu/solid-pierre";
import { type Component, Show } from "solid-js";
import { Portal } from "solid-js/web";

export type LineCommentMarkerProps = {
  /** Viewer scroll-root — search scope for the line lookup. */
  viewerEl: () => HTMLElement | null;
  /** Returns the line's content element under the current viewer, or
   *  null if the line isn't rendered (virtualized out, or the
   *  selection hasn't landed yet). Returning null hides the marker. */
  resolveLine: () => HTMLElement | null;
  /** When false, the marker is hidden and the rAF loop pauses. Lets
   *  the caller cheaply gate visibility without unmounting. */
  active: () => boolean;
  /** Visible glyph — "+" for new, "💬" for existing. */
  label: string;
  title: string;
  /** Click handler — caller switches to the composer. */
  onClick: () => void;
  /** data-testid for e2e selectors. */
  testid?: string;
};

const LineCommentMarker: Component<LineCommentMarkerProps> = (props) => {
  const pos = usePierreLineAnchor({
    viewerEl: props.viewerEl,
    resolveTarget: props.resolveLine,
    active: props.active,
  });

  return (
    <Show when={pos()}>
      {(p) => (
        <Portal>
          <button
            type="button"
            style={{
              position: "fixed",
              left: `${p().rightEdge + 8}px`,
              top: `${p().top - 2}px`,
              "z-index": "40",
            }}
            class="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-bg-0 text-[10px] font-medium shadow-md hover:scale-110 transition-transform cursor-pointer"
            title={props.title}
            data-testid={props.testid}
            onClick={(e) => {
              e.stopPropagation();
              props.onClick();
            }}
          >
            {props.label}
          </button>
        </Portal>
      )}
    </Show>
  );
};

export default LineCommentMarker;
