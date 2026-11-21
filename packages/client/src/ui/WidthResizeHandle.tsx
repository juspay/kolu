/** DRAG A SIDEBAR'S EDGE TO RESIZE IT — the gesture and the handle, shared by
 *  the Dock's maximized cards sidebar and the Conductor's works sidebar. The
 *  bounds, the clamp, the cap and the stored width are `resizableWidth.ts`.
 *
 *  THE STORED WIDTH IS WRITTEN ONCE PER DRAG. While the pointer moves, only a
 *  local, unpersisted drag width changes; `onEnd` commits it, a bare click on
 *  the handle (no motion) commits nothing, and a cancelled pointer drops it
 *  back to the stored width, which the drag never touched. The drag starts
 *  from the RENDERED width, so a host-capped sidebar does not jump on grab.
 *
 *  ONE POINTER OWNS A DRAG: a second pointerdown while one is in flight is
 *  ignored (a second touch or pen also reports button 0), and the gesture is
 *  bound to the initiating pointer. The owner's disposal aborts a drag in
 *  flight rather than leak window listeners. */

import { createElementSize } from "@solid-primitives/resize-observer";
import {
  type Accessor,
  type Component,
  createSignal,
  onCleanup,
} from "solid-js";
import { capturePointerGesture } from "../canvas/viewport/capturePointerGesture";
import type { ResizableWidth } from "./resizableWidth";

export interface WidthDrag {
  /** The width to render: the drag's while one is in flight, else the stored
   *  one, either way capped to the host. */
  readonly rendered: Accessor<number>;
  /** Start a drag from a pointerdown on the handle. */
  start(e: PointerEvent): void;
  /** Put the stored width back to its default. */
  reset(): void;
}

/** A drag over `width`, capped to `host` — the element the sidebar shares with
 *  its neighbour (`null` until it is known). Call from a component body. */
export function createWidthDrag(
  width: ResizableWidth,
  host: Accessor<HTMLElement | null>,
): WidthDrag {
  const hostSize = createElementSize(host);
  const [dragging, setDragging] = createSignal<number | null>(null);
  const rendered = (): number =>
    width.effective(dragging() ?? width.stored(), hostSize.width ?? 0);
  let abort: AbortController | null = null;
  onCleanup(() => abort?.abort());
  return {
    rendered,
    start: (e) => {
      // Primary button only: a right or middle drag on the edge is the
      // context menu's or a pan's.
      if (e.button !== 0 || abort !== null) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rendered();
      abort = new AbortController();
      capturePointerGesture(
        {
          onMove: (ev) =>
            setDragging(width.clamp(startWidth + (ev.clientX - startX))),
          onEnd: () => {
            const next = dragging();
            if (next !== null) width.set(next);
            setDragging(null);
            abort = null;
          },
          onCancel: () => {
            setDragging(null);
            abort = null;
          },
        },
        abort,
        e.pointerId,
      );
    },
    reset: () => width.set(width.bounds.defaultPx),
  };
}

/** The handle on the sidebar's right edge. Invisible until hover; the
 *  col-resize cursor is the affordance. A plain interactive div, as the canvas
 *  tile's resize handles are, rather than a `role="separator"` widget, which
 *  would need a focusable value range this drag has no keyboard step for.
 *  Double-click resets. The caller is the positioning context. */
export const WidthResizeHandle: Component<{
  drag: WidthDrag;
  testId: string;
}> = (props) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only resize affordance, same as CanvasTile's edge/corner handles — the cursor is the affordance, keyboard resize isn't offered for this drag
  <div
    data-testid={props.testId}
    class="absolute inset-y-0 right-0 z-40 w-1.5 cursor-col-resize transition-colors hover:bg-accent/30"
    title="Drag to resize · double-click to reset"
    onPointerDown={(e) => props.drag.start(e)}
    onDblClick={() => props.drag.reset()}
  />
);
