/** Pure viewport math — takes values, returns values. No signals, no DOM.
 *  Encapsulates the zoom/pan algorithm so it can evolve (easing, constraints,
 *  undo) without touching gesture input or CSS generation. */

import type { TileLayout } from "../useCanvasLayouts";

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
export const GRID_SIZE = 24;
const ZOOM_STEP = 1.25;

/** Clamp zoom to allowed range. */
export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Snap a value to the canvas grid. */
export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/** Divide a screen-space delta by zoom for canvas-space positioning. */
export function normalizeDelta(
  dx: number,
  dy: number,
  zoom: number,
): { dx: number; dy: number } {
  return { dx: dx / zoom, dy: dy / zoom };
}

/** Compute pan offset that centers a bounding box in the viewport. */
export function computeCenterPan(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  viewportW: number,
  viewportH: number,
  zoom: number,
): { panX: number; panY: number } {
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    panX: centerX - viewportW / (2 * zoom),
    panY: centerY - viewportH / (2 * zoom),
  };
}

/** Compute pan+zoom that fits all tiles in the viewport with padding.
 *  Caps zoom at 1.0 — never magnifies beyond native size. */
export function computeFitAll(
  tiles: TileLayout[],
  viewportW: number,
  viewportH: number,
): { panX: number; panY: number; zoom: number } {
  if (tiles.length === 0) return { panX: 0, panY: 0, zoom: 1 };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.w);
    maxY = Math.max(maxY, t.y + t.h);
  }
  if (!isFinite(minX)) return { panX: 0, panY: 0, zoom: 1 };

  const PAD = 80;
  const contentW = maxX - minX + PAD * 2;
  const contentH = maxY - minY + PAD * 2;
  const z = Math.min(
    Math.max(Math.min(viewportW / contentW, viewportH / contentH), MIN_ZOOM),
    1,
  );
  const pan = computeCenterPan(minX, minY, maxX, maxY, viewportW, viewportH, z);
  return { panX: pan.panX, panY: pan.panY, zoom: z };
}

/** Compute new pan+zoom after zooming by a factor toward a point.
 *  The point (in screen-space relative to container) stays fixed. */
export function zoomTowardPoint(
  panX: number,
  panY: number,
  currentZoom: number,
  factor: number,
  pointX: number,
  pointY: number,
): { panX: number; panY: number; zoom: number } {
  const newZoom = clampZoom(currentZoom * factor);
  return {
    panX: panX + pointX / currentZoom - pointX / newZoom,
    panY: panY + pointY / currentZoom - pointY / newZoom,
    zoom: newZoom,
  };
}

/** Compute new pan+zoom after zooming toward viewport center. */
export function zoomToCenter(
  panX: number,
  panY: number,
  currentZoom: number,
  viewportW: number,
  viewportH: number,
  direction: "in" | "out" | "reset",
): { panX: number; panY: number; zoom: number } {
  const cx = viewportW / 2;
  const cy = viewportH / 2;
  if (direction === "reset") {
    return {
      panX: panX + cx / currentZoom - cx,
      panY: panY + cy / currentZoom - cy,
      zoom: 1,
    };
  }
  const factor = direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomTowardPoint(panX, panY, currentZoom, factor, cx, cy);
}
