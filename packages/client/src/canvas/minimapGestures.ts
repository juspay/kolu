/** Minimap gesture handlers — maps minimap-space pointer events to canvas
 *  viewport operations. Separated from rendering so interaction behavior
 *  can evolve (keyboard nav, multi-touch) without touching the component. */

import { capturePointerGesture } from "./viewport/capturePointerGesture";
import type { CanvasViewport } from "./viewport/useCanvasViewport";

export interface MinimapBounds {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/** Minimum pixel distance before a pointerdown is considered a drag. */
const DRAG_THRESHOLD = 3;

interface MinimapDragHandlers {
  onDragStart?: () => void;
  onPreview: (dx: number, dy: number) => void;
  onCommit: (dx: number, dy: number) => void;
}

function startMinimapDrag(
  e: PointerEvent,
  minimapScale: number,
  abortPrevious: AbortController | null,
  handlers: MinimapDragHandlers,
): AbortController {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;

  abortPrevious?.abort();
  const abort = new AbortController();
  capturePointerGesture(
    {
      onMove: (ev) => {
        const px = ev.clientX - startX;
        const py = ev.clientY - startY;
        if (!dragging && Math.abs(px) + Math.abs(py) < DRAG_THRESHOLD) return;
        const dx = px / minimapScale;
        const dy = py / minimapScale;
        if (!dragging) {
          dragging = true;
          handlers.onDragStart?.();
        }
        handlers.onPreview(dx, dy);
      },
      onEnd: (ev) => {
        if (!dragging) return;
        const dx = (ev.clientX - startX) / minimapScale;
        const dy = (ev.clientY - startY) / minimapScale;
        handlers.onCommit(dx, dy);
      },
    },
    abort,
  );
  return abort;
}

/** Start dragging the viewport rectangle to pan the canvas.
 *  Captures scale at gesture start to avoid stale values mid-drag.
 *  Sets `didDrag` flag so click handlers can distinguish drag-end from click.
 *  Returns the gesture's AbortController — caller stores it and calls
 *  `.abort()` on re-entry to cancel any in-flight gesture. */
export function startViewportDrag(
  e: PointerEvent,
  viewport: CanvasViewport,
  minimapScale: number,
  abortPrevious: AbortController | null,
  onDragStateChange: (dragging: boolean) => void,
): AbortController {
  const startPanX = viewport.panX();
  const startPanY = viewport.panY();
  return startMinimapDrag(e, minimapScale, abortPrevious, {
    onDragStart: () => onDragStateChange(true),
    onPreview: (dx, dy) => viewport.setPan(startPanX + dx, startPanY + dy),
    onCommit: (dx, dy) => {
      viewport.setPan(startPanX + dx, startPanY + dy);
      onDragStateChange(false);
    },
  });
}

export function startTileDrag(
  e: PointerEvent,
  minimapScale: number,
  abortPrevious: AbortController | null,
  handlers: MinimapDragHandlers,
): AbortController {
  return startMinimapDrag(e, minimapScale, abortPrevious, handlers);
}

/** Click on the minimap background to pan the canvas to that point.
 *  Converts minimap-local click coordinates to canvas-space via the
 *  current scale and bounds. */
export function handleMinimapClick(
  e: MouseEvent,
  viewport: CanvasViewport,
  minimapScale: number,
  bounds: MinimapBounds,
) {
  const target = e.currentTarget as HTMLDivElement;
  const rect = target.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / minimapScale + bounds.minX;
  const cy = (e.clientY - rect.top) / minimapScale + bounds.minY;
  viewport.panTo(cx, cy);
}
