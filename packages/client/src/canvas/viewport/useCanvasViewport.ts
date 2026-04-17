/** Canvas viewport orchestrator — singleton state that wires together
 *  gesture input, transform math, and CSS coordinate generation.
 *
 *  Consumers import only this module. The three internal modules
 *  (gestures, transforms, coordinates) are implementation details. */

import { createSignal, type Accessor } from "solid-js";
import type { TileLayout } from "../TileLayout";
import { installGestures } from "./gestures";
import {
  clampZoom,
  computeCenterPan,
  normalizeDelta as normalizeDeltaPure,
  snapToGrid as snapToGridPure,
  zoomToCenter as zoomToCenterPure,
  zoomTowardPoint,
} from "./transforms";
import {
  canvasTransformCSS,
  gridBgPositionCSS,
  gridBgSizeCSS,
} from "./coordinates";
import { animatePan } from "./animatedPan";

// ── Singleton state ──

const [panX, setPanX] = createSignal(0);
const [panY, setPanY] = createSignal(0);
const [zoom, setZoom] = createSignal(1);

/** Container ref, set on mount. */
let containerEl: HTMLDivElement | null = null;
/** Cleanup function for the current gesture listeners. */
let cleanupGestures: (() => void) | null = null;
/** In-flight pan animation (if any) — cancelled by any gesture or
 *  instant pan so external input always wins over an ongoing tween. */
let currentAnim: AbortController | null = null;

function cancelPanAnimation() {
  currentAnim?.abort();
  currentAnim = null;
}

// ── Public API ──

export interface CanvasViewport {
  panX: Accessor<number>;
  panY: Accessor<number>;
  zoom: Accessor<number>;
  /** Set container ref — installs gesture listeners. `shouldYieldWheel`, if
   *  provided, lets callers opt specific wheel targets out of canvas pan so
   *  scrollable tile content (e.g. a terminal) owns its own scroll gesture. */
  setContainerRef: (
    el: HTMLDivElement,
    shouldYieldWheel?: (e: WheelEvent) => boolean,
  ) => void;
  /** Divide a screen-space delta by zoom for canvas-space positioning. */
  normalizeDelta: (dx: number, dy: number) => { dx: number; dy: number };
  /** Set pan so a specific tile is centered. */
  centerOnTile: (tile: TileLayout) => void;
  /** Animated variant of `centerOnTile` — tweens over ~150ms. Cancels on
   *  any subsequent gesture or instant pan call. Respects
   *  `prefers-reduced-motion`. */
  centerOnTileAnimated: (tile: TileLayout) => void;
  /** Pan so canvas-space point (x, y) is centered in the viewport. */
  panTo: (x: number, y: number) => void;
  /** Animated variant of `panTo`. Same cancel + reduced-motion semantics. */
  panToAnimated: (x: number, y: number) => void;
  /** Set pan offset directly (canvas-space coordinates). */
  setPan: (x: number, y: number) => void;
  /** Current viewport dimensions in pixels (0×0 before mount). */
  viewportSize: () => { width: number; height: number };
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

function setContainerRef(
  el: HTMLDivElement,
  shouldYieldWheel?: (e: WheelEvent) => boolean,
) {
  cleanupGestures?.();
  containerEl = el;
  cleanupGestures = installGestures(
    el,
    {
      onPan: (dx, dy) => {
        cancelPanAnimation();
        const z = zoom();
        setPanX(panX() + dx / z);
        setPanY(panY() + dy / z);
      },
      onZoom: (factor, sx, sy) => {
        cancelPanAnimation();
        const result = zoomTowardPoint(panX(), panY(), zoom(), factor, sx, sy);
        setPanX(result.panX);
        setPanY(result.panY);
        setZoom(result.zoom);
      },
    },
    shouldYieldWheel,
  );
}

function normalizeDelta(dx: number, dy: number) {
  return normalizeDeltaPure(dx, dy, zoom());
}

function targetForTile(
  tile: TileLayout,
): { panX: number; panY: number } | null {
  if (!containerEl) return null;
  return computeCenterPan(
    tile.x,
    tile.y,
    tile.x + tile.w,
    tile.y + tile.h,
    containerEl.clientWidth,
    containerEl.clientHeight,
    zoom(),
  );
}

function targetForPoint(
  x: number,
  y: number,
): { panX: number; panY: number } | null {
  if (!containerEl) return null;
  return computeCenterPan(
    x,
    y,
    x,
    y,
    containerEl.clientWidth,
    containerEl.clientHeight,
    zoom(),
  );
}

function centerOnTile(tile: TileLayout) {
  const t = targetForTile(tile);
  if (!t) return;
  cancelPanAnimation();
  setPanX(t.panX);
  setPanY(t.panY);
}

function panTo(x: number, y: number) {
  const t = targetForPoint(x, y);
  if (!t) return;
  cancelPanAnimation();
  setPanX(t.panX);
  setPanY(t.panY);
}

function setPan(x: number, y: number) {
  cancelPanAnimation();
  setPanX(x);
  setPanY(y);
}

function startAnimatedPan(target: { panX: number; panY: number }) {
  cancelPanAnimation();
  currentAnim = animatePan(
    { x: panX(), y: panY() },
    { x: target.panX, y: target.panY },
    (x, y) => {
      setPanX(x);
      setPanY(y);
    },
  );
}

function centerOnTileAnimated(tile: TileLayout) {
  const t = targetForTile(tile);
  if (t) startAnimatedPan(t);
}

function panToAnimated(x: number, y: number) {
  const t = targetForPoint(x, y);
  if (t) startAnimatedPan(t);
}

// Not reactive on container resize — reads DOM directly. Pan/zoom signals
// trigger dependents often enough that stale dimensions are short-lived.
function viewportSize() {
  return {
    width: containerEl?.clientWidth ?? 0,
    height: containerEl?.clientHeight ?? 0,
  };
}

function applyZoomToCenter(direction: "in" | "out" | "reset") {
  if (!containerEl) return;
  cancelPanAnimation();
  const result = zoomToCenterPure(
    panX(),
    panY(),
    zoom(),
    containerEl.clientWidth,
    containerEl.clientHeight,
    direction,
  );
  setPanX(result.panX);
  setPanY(result.panY);
  setZoom(result.zoom);
}

const viewport: CanvasViewport = {
  panX,
  panY,
  zoom,
  setContainerRef,
  normalizeDelta,
  centerOnTile,
  centerOnTileAnimated,
  panTo,
  panToAnimated,
  setPan,
  viewportSize,
  snapToGrid: snapToGridPure,
  gridBgPosition: () => gridBgPositionCSS(panX(), panY(), zoom()),
  gridBgSize: () => gridBgSizeCSS(zoom()),
  canvasTransform: () => canvasTransformCSS(panX(), panY(), zoom()),
  zoomIn: () => applyZoomToCenter("in"),
  zoomOut: () => applyZoomToCenter("out"),
  resetZoom: () => applyZoomToCenter("reset"),
};

export function useCanvasViewport(): CanvasViewport {
  return viewport;
}
