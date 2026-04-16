/** Canvas viewport state — pan offset, zoom level, and coordinate transforms.
 *  Singleton store (like useCanvasLayouts) shared between TerminalCanvas
 *  (rendering + gestures) and App.tsx (keyboard shortcuts).
 *
 *  Viewport model: panX/panY represent the canvas-space point at the top-left
 *  corner of the visible viewport. Zoom scales the canvas around the cursor. */

import { createSignal, type Accessor } from "solid-js";
import type { TileLayout } from "./useCanvasLayouts";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const ZOOM_SPEED = 0.002;
export const GRID_SIZE = 24;

// ── Singleton state ──

const [panX, setPanX] = createSignal(0);
const [panY, setPanY] = createSignal(0);
const [zoom, setZoom] = createSignal(1);

/** Container ref, set by TerminalCanvas on mount. */
let containerEl: HTMLDivElement | null = null;
/** Abort controller for the previous wheel listener (prevents stacking on re-mount). */
let wheelAbort: AbortController | null = null;

// ── Pure helpers ──

/** Compute pan offset that centers a bounding box in the viewport. */
function computeCenterPan(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  viewportW: number,
  viewportH: number,
  z: number,
): { panX: number; panY: number } {
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    panX: centerX - viewportW / (2 * z),
    panY: centerY - viewportH / (2 * z),
  };
}

/** Compute pan+zoom that fits a bounding box in the viewport with padding. */
function computeFitAll(
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
  // Cap at 1.0 — fitAll should zoom out to show everything, never magnify
  // beyond native size. Users can zoom in manually if they want closer.
  const z = Math.min(
    Math.max(Math.min(viewportW / contentW, viewportH / contentH), MIN_ZOOM),
    1,
  );
  const pan = computeCenterPan(minX, minY, maxX, maxY, viewportW, viewportH, z);
  return { panX: pan.panX, panY: pan.panY, zoom: z };
}

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

// ── Public API ──

export interface CanvasViewport {
  panX: Accessor<number>;
  panY: Accessor<number>;
  zoom: Accessor<number>;
  /** Set container ref — installs wheel/gesture listeners. */
  setContainerRef: (el: HTMLDivElement) => void;
  /** Divide a screen-space delta by zoom for canvas-space positioning. */
  normalizeDelta: (dx: number, dy: number) => { dx: number; dy: number };
  /** Set pan+zoom so all tiles are centered in the viewport. */
  fitAll: (tiles: TileLayout[]) => void;
  /** Set pan so a specific tile is centered. */
  centerOnTile: (tile: TileLayout) => void;
  /** Snap a value to the canvas grid. */
  snapToGrid: (value: number) => number;
  /** CSS background-position for the grid, tracking pan+zoom. */
  gridBgPosition: Accessor<string>;
  /** CSS background-size for the grid, tracking zoom. */
  gridBgSize: Accessor<string>;
  /** CSS transform for the inner canvas div. */
  canvasTransform: Accessor<string>;
  /** Step zoom in toward viewport center. */
  zoomIn: () => void;
  /** Step zoom out from viewport center. */
  zoomOut: () => void;
  /** Reset zoom to 100%, keeping the same center point. */
  resetZoom: () => void;
}

function setContainerRef(el: HTMLDivElement) {
  // Remove previous listener if canvas was re-mounted (toggle off/on)
  wheelAbort?.abort();
  wheelAbort = new AbortController();
  containerEl = el;
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom — pinch-to-zoom on trackpad also fires as ctrl+wheel
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const oldZoom = zoom();
        const newZoom = clampZoom(oldZoom * (1 - e.deltaY * ZOOM_SPEED));
        // Zoom toward cursor: keep the canvas point under cursor fixed
        setPanX(panX() + sx / oldZoom - sx / newZoom);
        setPanY(panY() + sy / oldZoom - sy / newZoom);
        setZoom(newZoom);
      } else {
        // Pan — two-finger scroll / trackpad swipe / mousewheel
        const z = zoom();
        setPanX(panX() + e.deltaX / z);
        setPanY(panY() + e.deltaY / z);
      }
    },
    { passive: false, signal: wheelAbort!.signal },
  );

  // Middle-mouse drag pan (hand tool)
  let panDragAbort: AbortController | null = null;

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      panDragAbort?.abort();
      panDragAbort = new AbortController();
      const { signal } = panDragAbort;
      const startPanX = panX();
      const startPanY = panY();
      const startX = e.clientX;
      const startY = e.clientY;
      el.style.cursor = "grabbing";

      window.addEventListener(
        "pointermove",
        (ev) => {
          const z = zoom();
          setPanX(startPanX - (ev.clientX - startX) / z);
          setPanY(startPanY - (ev.clientY - startY) / z);
        },
        { signal },
      );
      window.addEventListener(
        "pointerup",
        () => {
          panDragAbort?.abort();
          panDragAbort = null;
          el.style.cursor = "";
        },
        { signal },
      );
    },
    { signal: wheelAbort!.signal },
  );
}

function normalizeDelta(dx: number, dy: number) {
  const z = zoom();
  return { dx: dx / z, dy: dy / z };
}

function fitAll(tiles: TileLayout[]) {
  if (!containerEl) return;
  const result = computeFitAll(
    tiles,
    containerEl.clientWidth,
    containerEl.clientHeight,
  );
  setPanX(result.panX);
  setPanY(result.panY);
  setZoom(result.zoom);
}

function centerOnTile(tile: TileLayout) {
  if (!containerEl) return;
  const z = zoom();
  const pan = computeCenterPan(
    tile.x,
    tile.y,
    tile.x + tile.w,
    tile.y + tile.h,
    containerEl.clientWidth,
    containerEl.clientHeight,
    z,
  );
  setPanX(pan.panX);
  setPanY(pan.panY);
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

const ZOOM_STEP = 1.25; // each click multiplies/divides by this factor

/** Zoom toward the center of the viewport by the given factor. */
function zoomToCenter(factor: number) {
  if (!containerEl) return;
  const cx = containerEl.clientWidth / 2;
  const cy = containerEl.clientHeight / 2;
  const oldZoom = zoom();
  const newZoom = clampZoom(oldZoom * factor);
  setPanX(panX() + cx / oldZoom - cx / newZoom);
  setPanY(panY() + cy / oldZoom - cy / newZoom);
  setZoom(newZoom);
}

function zoomIn() {
  zoomToCenter(ZOOM_STEP);
}

function zoomOut() {
  zoomToCenter(1 / ZOOM_STEP);
}

function resetZoom() {
  if (!containerEl) return;
  const cx = containerEl.clientWidth / 2;
  const cy = containerEl.clientHeight / 2;
  const oldZoom = zoom();
  // Keep the center point fixed while resetting to 100%
  setPanX(panX() + cx / oldZoom - cx);
  setPanY(panY() + cy / oldZoom - cy);
  setZoom(1);
}

const gridBgPosition = () => `${-panX() * zoom()}px ${-panY() * zoom()}px`;

const gridBgSize = () => {
  const s = GRID_SIZE * zoom();
  return `${s}px ${s}px`;
};

const canvasTransform = () => {
  const z = zoom();
  return `scale(${z}) translate(${-panX()}px, ${-panY()}px)`;
};

const viewport: CanvasViewport = {
  panX,
  panY,
  zoom,
  setContainerRef,
  normalizeDelta,
  fitAll,
  centerOnTile,
  snapToGrid,
  gridBgPosition,
  gridBgSize,
  canvasTransform,
  zoomIn,
  zoomOut,
  resetZoom,
};

export function useCanvasViewport(): CanvasViewport {
  return viewport;
}
