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

/** Start dragging the viewport rectangle to pan the canvas.
 *  Captures scale at gesture start to avoid stale values mid-drag.
 *  Sets `didDrag` flag so click handlers can distinguish drag-end from click.
 *  Returns an abort function (caller must store and call on re-entry). */
export function startViewportDrag(
  e: PointerEvent,
  viewport: CanvasViewport,
  minimapScale: number,
  abortPrevious: (() => void) | null,
  onDragStateChange: (dragging: boolean) => void,
): () => void {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startPanX = viewport.panX();
  const startPanY = viewport.panY();
  let dragging = false;

  abortPrevious?.();
  return capturePointerGesture({
    onMove: (ev) => {
      const px = ev.clientX - startX;
      const py = ev.clientY - startY;
      if (!dragging && Math.abs(px) + Math.abs(py) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        onDragStateChange(true);
      }
      viewport.setPan(startPanX + px / minimapScale, startPanY + py / minimapScale);
    },
    onEnd: () => {
      if (dragging) onDragStateChange(false);
    },
  });
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
