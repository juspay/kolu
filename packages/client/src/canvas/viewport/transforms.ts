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

/** Canvas-space point at the viewport center — the forward projection that is
 *  the inverse of `computeCenterPan` (which solves the opposite direction:
 *  given a desired center, what pan lands it there). */
export function viewportCenter(
  panX: number,
  panY: number,
  viewportW: number,
  viewportH: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: panX + viewportW / (2 * zoom),
    y: panY + viewportH / (2 * zoom),
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
 *  frame's *net effective* zoom factor (1 = no zoom) toward `zoomAnchor` (the
 *  last event's screen-space point) — i.e. `finalZoom / startZoom`, where the
 *  accumulator has ALREADY clamped each event's zoom to `[MIN_ZOOM, MAX_ZOOM]`
 *  as it arrived (see `accumulateZoom`). It is NOT the raw product of factors:
 *  multiplying factors and clamping once would let an overshoot past a bound
 *  cancel a later reversal (e.g. at MAX_ZOOM, `[1.25, 0.8]` has product 1 and
 *  would not move, but per-event the first clamps to the bound and the second
 *  zooms back out). Pre-clamping per event matches the old per-event path. */
export interface GestureBatch {
  panDx: number;
  panDy: number;
  zoomFactor: number;
  zoomAnchorX: number;
  zoomAnchorY: number;
}

/** Fold one raw wheel zoom factor into a batch's accumulated net factor,
 *  clamping per-event exactly as the old per-event path did.
 *
 *  `startZoom` is the viewport zoom when this frame's accumulation began. We
 *  track the running clamped zoom as `startZoom * batch.zoomFactor`, apply the
 *  next factor, clamp, and store the new net factor `clampedZoom / startZoom`.
 *  Because the anchor is fixed across the frame, the per-event pan corrections
 *  still telescope to `point/startZoom − point/clampedZoom` even when an
 *  intermediate event clamped (the intermediate zooms cancel pairwise), so the
 *  batch needs only this net factor — not the per-event sequence. */
export function accumulateZoom(
  batch: GestureBatch,
  startZoom: number,
  factor: number,
): void {
  const running = startZoom * batch.zoomFactor;
  batch.zoomFactor = clampZoom(running * factor) / startZoom;
}

/** Apply one frame's coalesced gesture batch to a viewport state.
 *
 *  Behaviour-preserving for the two regimes that actually occur per frame:
 *  PURE pan (the summed screen delta ÷ zoom equals the sum of per-event deltas,
 *  since pan is additive in canvas space) and PURE zoom (successive
 *  `zoomTowardPoint` calls toward a fixed anchor telescope — their `point/zoom`
 *  correction terms cancel — so the net effective factor lands on the same
 *  pan+zoom; per-event clamping is folded in by `accumulateZoom`, so this holds
 *  even when a frame crosses MIN_ZOOM/MAX_ZOOM). Both are proven in
 *  transforms.test.ts. A wheel event is EITHER pan (plain/shift) OR zoom
 *  (ctrl/meta), never both, so a given gesture is overwhelmingly one regime.
 *
 *  For the rare frame that MIXES pan and zoom (e.g. a pointer-drag pan while
 *  ctrl+wheel zooming), this is a deliberate, bounded approximation rather than
 *  exact per-event replay: zoom is applied first and the whole summed pan delta
 *  divides by the POST-zoom scale, instead of each pan delta dividing by the
 *  zoom in effect at its own event. The discrepancy is one frame's worth of
 *  zoom change (a few percent of a sub-pixel pan offset) and does not
 *  accumulate — the next frame's pan divides by the then-current zoom. We pick
 *  this canonical order over preserving event sequence because exact replay
 *  would mean storing and re-walking the per-event list, which is the
 *  per-event work R4 exists to delete. */
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
