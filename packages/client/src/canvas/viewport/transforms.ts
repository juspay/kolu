/** Pure viewport math — takes values, returns values. No signals, no DOM.
 *  Encapsulates the zoom/pan algorithm so it can evolve (easing, constraints,
 *  undo) without touching gesture input or CSS generation. */

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
