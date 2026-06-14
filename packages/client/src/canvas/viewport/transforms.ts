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

/** One animation frame's worth of coalesced wheel gestures.
 *  `panDx/panDy` is the *summed* screen-space pan delta; `zoomFactor` is the
 *  *product* of the frame's zoom factors (1 = no zoom) toward `zoomAnchor`
 *  (the last event's screen-space point). */
export interface GestureBatch {
  panDx: number;
  panDy: number;
  zoomFactor: number;
  zoomAnchorX: number;
  zoomAnchorY: number;
}

/** Apply one frame's coalesced gesture batch to a viewport state.
 *
 *  Behaviour-preserving by construction: the batched result equals applying
 *  each raw wheel event in turn within the frame. Pan is additive in canvas
 *  space, so a summed screen delta ÷ zoom equals the sum of per-event deltas.
 *  Zoom telescopes — successive `zoomTowardPoint` calls toward a fixed anchor
 *  have their `point/zoom` correction terms cancel, so the product of factors
 *  toward that anchor lands on the same pan+zoom (proven in transforms.test.ts).
 *  Zoom is applied first so the pan delta lands in the post-zoom scale, the
 *  canonical order for the rare frame that mixes both. */
export function applyGestureBatch(
  panX: number,
  panY: number,
  zoom: number,
  batch: GestureBatch,
): { panX: number; panY: number; zoom: number } {
  let nx = panX;
  let ny = panY;
  let nz = zoom;
  if (batch.zoomFactor !== 1) {
    const r = zoomTowardPoint(
      nx,
      ny,
      nz,
      batch.zoomFactor,
      batch.zoomAnchorX,
      batch.zoomAnchorY,
    );
    nx = r.panX;
    ny = r.panY;
    nz = r.zoom;
  }
  if (batch.panDx !== 0 || batch.panDy !== 0) {
    nx += batch.panDx / nz;
    ny += batch.panDy / nz;
  }
  return { panX: nx, panY: ny, zoom: nz };
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
