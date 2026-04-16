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

/** Start dragging the viewport rectangle to pan the canvas.
 *  Captures scale at gesture start to avoid stale values mid-drag.
 *  Returns an abort function (caller must store and call on re-entry). */
export function startViewportDrag(
  e: PointerEvent,
  viewport: CanvasViewport,
  minimapScale: number,
  abortPrevious: (() => void) | null,
): () => void {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const startPanX = viewport.panX();
  const startPanY = viewport.panY();

  abortPrevious?.();
  return capturePointerGesture({
    onMove: (ev) => {
      const dx = (ev.clientX - startX) / minimapScale;
      const dy = (ev.clientY - startY) / minimapScale;
      viewport.setPan(startPanX + dx, startPanY + dy);
    },
    onEnd: () => {
      // Caller nulls its stored abort ref via the returned cleanup
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
