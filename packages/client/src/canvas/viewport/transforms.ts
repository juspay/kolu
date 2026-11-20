export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
export const GRID_SIZE = 24;
const ZOOM_STEP = 1.25;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function normalizeDelta(
  dx: number,
  dy: number,
  zoom: number,
): { dx: number; dy: number } {
  return { dx: dx / zoom, dy: dy / zoom };
}

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

declare const netClampedZoomRatio: unique symbol;

export type NetClampedZoomRatio = number & {
  readonly [netClampedZoomRatio]: true;
};

export const NO_ZOOM = 1 as NetClampedZoomRatio;

export interface GestureBatch {
  panDx: number;
  panDy: number;
  netClampedZoomRatio: NetClampedZoomRatio;
  zoomAnchorX: number;
  zoomAnchorY: number;
}

export function accumulateZoom(
  batch: GestureBatch,
  startZoom: number,
  factor: number,
): void {
  const running = startZoom * batch.netClampedZoomRatio;
  batch.netClampedZoomRatio = (clampZoom(running * factor) /
    startZoom) as NetClampedZoomRatio;
}

export function applyZoomThenPan(
  panX: number,
  panY: number,
  zoom: number,
  batch: GestureBatch,
): { panX: number; panY: number; zoom: number } {
  let nx = panX;
  let ny = panY;
  let nz = zoom;
  if (batch.netClampedZoomRatio !== NO_ZOOM) {
    const r = zoomTowardPoint(
      nx,
      ny,
      nz,
      batch.netClampedZoomRatio,
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
