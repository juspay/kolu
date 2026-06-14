/** Canvas viewport orchestrator — singleton state that wires together
 *  gesture input, transform math, and CSS coordinate generation.
 *
 *  Consumers import only this module. The three internal modules
 *  (gestures, transforms, coordinates) are implementation details. */

import { type Accessor, createSignal } from "solid-js";
import type { TileLayout } from "../TileLayout";
import { animatePan } from "./animatedPan";
import {
  canvasTransformCSS,
  gridBgPositionCSS,
  gridBgSizeCSS,
} from "./coordinates";
import { installGestures } from "./gestures";
import {
  applyGestureBatch,
  computeCenterPan,
  normalizeDelta as normalizeDeltaPure,
  snapToGrid as snapToGridPure,
  zoomToCenter as zoomToCenterPure,
} from "./transforms";

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

// ── rAF-coalesced gesture application ──
//
// Wheel events arrive at ~166/s — several per animation frame. Writing
// panX/panY/zoom on *every* event makes every mounted tile recompute its
// transform per event, even though only the last state before the next paint is
// ever shown. #1308 measured that write-storm (a zoom fling = 9,600 tile writes)
// and under a throttled CPU it dropped frames — p99 past 33ms, 148 dropped
// frames at 6× (docs/perf-investigations/canvas-gesture-p99.md). We accumulate
// the frame's pan delta (sum) and zoom factor (product, toward the last anchor)
// and apply them ONCE per rAF. The per-frame state is identical to the per-event
// path — `applyGestureBatch` telescopes the math — so feel is unchanged; only
// the redundant intra-frame recomputes vanish. Mutable scalars (not an object)
// keep the per-event hot path allocation-free.
let pendingDx = 0;
let pendingDy = 0;
let pendingZoomFactor = 1;
let zoomAnchorX = 0;
let zoomAnchorY = 0;
let gestureRaf = 0;

function scheduleGestureFlush() {
  if (gestureRaf) return;
  gestureRaf = requestAnimationFrame(flushGesture);
}

function flushGesture() {
  gestureRaf = 0;
  const result = applyGestureBatch(panX(), panY(), zoom(), {
    panDx: pendingDx,
    panDy: pendingDy,
    zoomFactor: pendingZoomFactor,
    zoomAnchorX,
    zoomAnchorY,
  });
  pendingDx = 0;
  pendingDy = 0;
  pendingZoomFactor = 1;
  // Equal-value writes are no-ops (SolidJS skips on Object.is), so a pure-pan
  // frame never notifies zoom dependents and vice versa.
  setPanX(result.panX);
  setPanY(result.panY);
  setZoom(result.zoom);
}

/** Drop any queued gesture delta — a programmatic absolute pan/zoom (or a
 *  container swap) is the new truth, so a frame-late fling delta must not land
 *  on top of it. */
function discardPendingGesture() {
  if (gestureRaf) {
    cancelAnimationFrame(gestureRaf);
    gestureRaf = 0;
  }
  pendingDx = 0;
  pendingDy = 0;
  pendingZoomFactor = 1;
}

/** Begin an authoritative absolute mutation: a programmatic write is the new
 *  truth, so it must kill BOTH competing input sources — the in-flight tween
 *  and the queued gesture delta. Every programmatic setter plugs into this one
 *  seam so it cannot forget half the arbitration. */
function beginAuthoritativeMutation() {
  cancelPanAnimation();
  discardPendingGesture();
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
  /** Pan so a specific tile is centered. Animates over ~150ms. Cancels on
   *  any subsequent gesture or `setPan` call. Respects
   *  `prefers-reduced-motion` (jumps to target). */
  centerOnTile: (tile: TileLayout) => void;
  /** Pan so canvas-space point (x, y) is centered in the viewport.
   *  Same animation + cancel semantics as `centerOnTile`. */
  panTo: (x: number, y: number) => void;
  /** Set pan offset directly (canvas-space coordinates). Instant — for
   *  per-frame gesture updates that must not animate. */
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
  discardPendingGesture();
  containerEl = el;
  cleanupGestures = installGestures(
    el,
    {
      // Accumulate per-event; `flushGesture` applies the frame's batch once.
      // `cancelPanAnimation` stays synchronous so a wheel still interrupts an
      // in-flight tween on the very first event, not a frame later.
      onPan: (dx, dy) => {
        cancelPanAnimation();
        pendingDx += dx;
        pendingDy += dy;
        scheduleGestureFlush();
      },
      onZoom: (factor, sx, sy) => {
        cancelPanAnimation();
        pendingZoomFactor *= factor;
        zoomAnchorX = sx;
        zoomAnchorY = sy;
        scheduleGestureFlush();
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

function startAnimatedPan(target: { panX: number; panY: number }) {
  beginAuthoritativeMutation();
  currentAnim = animatePan(
    { x: panX(), y: panY() },
    { x: target.panX, y: target.panY },
    (x, y) => {
      setPanX(x);
      setPanY(y);
    },
  );
}

function centerOnTile(tile: TileLayout) {
  const t = targetForTile(tile);
  if (t) startAnimatedPan(t);
}

function panTo(x: number, y: number) {
  const t = targetForPoint(x, y);
  if (t) startAnimatedPan(t);
}

function setPan(x: number, y: number) {
  beginAuthoritativeMutation();
  setPanX(x);
  setPanY(y);
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
  beginAuthoritativeMutation();
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
  panTo,
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
