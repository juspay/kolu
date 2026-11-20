import { type Accessor, batch, onCleanup } from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import type { HostCamera } from "../../hostScope/createCamera";
import { hostIndependentSignal } from "../../hostScope/hostIndependent";
import { activeScope } from "../../hostScope/hostScopes";
import type { TileLayout } from "../TileLayout";
import { animatePan } from "./animatedPan";
import {
  canvasTransformCSS,
  gridBgPositionCSS,
  gridBgSizeCSS,
} from "./coordinates";
import { type GesturePolicy, installGestures } from "./gestures";
import {
  accumulateZoom,
  applyZoomThenPan,
  computeCenterPan,
  type GestureBatch,
  NO_ZOOM,
  normalizeDelta as normalizeDeltaPure,
  snapToGrid as snapToGridPure,
  viewportCenter as viewportCenterPure,
  zoomToCenter as zoomToCenterPure,
} from "./transforms";

type CameraControls = Pick<
  HostCamera,
  "panX" | "panY" | "zoom" | "setPanX" | "setPanY" | "setZoom"
>;

const NEUTRAL_CAMERA: CameraControls = {
  panX: () => 0,
  panY: () => 0,
  zoom: () => 1,
  setPanX: () => {},
  setPanY: () => {},
  setZoom: () => {},
};

const cameraOrNeutral = (): CameraControls =>
  activeScope()?.camera ?? NEUTRAL_CAMERA;
const panX = (): number => cameraOrNeutral().panX();
const panY = (): number => cameraOrNeutral().panY();
const zoom = (): number => cameraOrNeutral().zoom();
const setPanX = (v: number): void => cameraOrNeutral().setPanX(v);
const setPanY = (v: number): void => cameraOrNeutral().setPanY(v);
const setZoom = (v: number): void => cameraOrNeutral().setZoom(v);

let containerEl: HTMLDivElement | null = null;
const [observedSize, setObservedSize] = hostIndependentSignal<{
  width: number;
  height: number;
}>();
let cleanupGestures: (() => void) | null = null;
let currentAnim: AbortController | null = null;
const [panAnimating, setPanAnimating] = hostIndependentSignal(false);

function cancelPanAnimation() {
  currentAnim?.abort();
  currentAnim = null;
  setPanAnimating(false);
}

const EMPTY: GestureBatch = {
  panDx: 0,
  panDy: 0,
  netClampedZoomRatio: NO_ZOOM,
  zoomAnchorX: 0,
  zoomAnchorY: 0,
};
let pending: GestureBatch = { ...EMPTY };
let zoomStart = 1;
let gestureRaf = 0;

function scheduleGestureFlush() {
  if (gestureRaf) return;
  gestureRaf = requestAnimationFrame(flushGesture);
}

function flushGesture() {
  gestureRaf = 0;
  const result = applyZoomThenPan(panX(), panY(), zoom(), pending);
  pending = { ...EMPTY };
  batch(() => {
    setPanX(result.panX);
    setPanY(result.panY);
    setZoom(result.zoom);
  });
}

function discardPendingGesture() {
  if (gestureRaf) {
    cancelAnimationFrame(gestureRaf);
    gestureRaf = 0;
  }
  pending = { ...EMPTY };
}

function abortTransientInput() {
  cancelPanAnimation();
  discardPendingGesture();
}

export interface CanvasViewport {
  panX: Accessor<number>;
  panY: Accessor<number>;
  zoom: Accessor<number>;
  setContainerRef: (el: HTMLDivElement, policy: GesturePolicy) => void;
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
  abortTransientInput: () => void;
  /** Whether the mounted viewport has received its first layout measurement. */
  mounted: Accessor<boolean>;
  viewportSize: () => { width: number; height: number };
  viewportCenter: () => { x: number; y: number } | null;
  snapToGrid: (value: number) => number;
  gridBgPosition: Accessor<string>;
  gridBgSize: Accessor<string>;
  canvasTransform: Accessor<string>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  cameraSettled: Accessor<boolean>;
}

function setContainerRef(el: HTMLDivElement, policy: GesturePolicy) {
  cleanupGestures?.();
  discardPendingGesture();
  containerEl = el;
  // A mount-time read can still see Corvu's temporary equal-width panels.
  // The first observer delivery follows layout, so initial placement waits for
  // the same authoritative measurement used for every subsequent resize.
  createResizeObserver(el, ({ width, height }) =>
    setObservedSize({ width, height }),
  );
  onCleanup(() => {
    if (containerEl !== el) return;
    cleanupGestures?.();
    cleanupGestures = null;
    abortTransientInput();
    containerEl = null;
    setObservedSize(undefined);
  });
  cleanupGestures = installGestures(
    el,
    {
      onPan: (dx, dy) => {
        cancelPanAnimation();
        pending.panDx += dx;
        pending.panDy += dy;
        scheduleGestureFlush();
      },
      onZoom: (factor, sx, sy) => {
        cancelPanAnimation();
        if (pending.netClampedZoomRatio === NO_ZOOM) zoomStart = zoom();
        accumulateZoom(pending, zoomStart, factor);
        pending.zoomAnchorX = sx;
        pending.zoomAnchorY = sy;
        scheduleGestureFlush();
      },
    },
    policy,
  );
}

function normalizeDelta(dx: number, dy: number) {
  return normalizeDeltaPure(dx, dy, zoom());
}

function targetForTile(
  tile: TileLayout,
): { panX: number; panY: number } | null {
  if (!observedSize()) return null;
  return computeCenterPan(
    tile.x,
    tile.y,
    tile.x + tile.w,
    tile.y + tile.h,
    viewportSize().width,
    viewportSize().height,
    zoom(),
  );
}

function targetForPoint(
  x: number,
  y: number,
): { panX: number; panY: number } | null {
  if (!observedSize()) return null;
  return computeCenterPan(
    x,
    y,
    x,
    y,
    viewportSize().width,
    viewportSize().height,
    zoom(),
  );
}

function startAnimatedPan(target: { panX: number; panY: number }) {
  abortTransientInput();
  setPanAnimating(true);
  currentAnim = animatePan(
    { x: panX(), y: panY() },
    { x: target.panX, y: target.panY },
    (x, y) => {
      batch(() => {
        setPanX(x);
        setPanY(y);
      });
    },
    { onDone: () => setPanAnimating(false) },
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
  abortTransientInput();
  batch(() => {
    setPanX(x);
    setPanY(y);
  });
}

function viewportSize() {
  const size = observedSize();
  if (!size)
    throw new Error(
      "Canvas viewport size requested before its first measurement",
    );
  return { width: size.width, height: size.height };
}

function viewportCenter() {
  if (!observedSize()) return null;
  const { width, height } = viewportSize();
  return viewportCenterPure(panX(), panY(), width, height, zoom());
}

function applyZoomToCenter(direction: "in" | "out" | "reset") {
  if (!observedSize()) return;
  abortTransientInput();
  const result = zoomToCenterPure(
    panX(),
    panY(),
    zoom(),
    viewportSize().width,
    viewportSize().height,
    direction,
  );
  batch(() => {
    setPanX(result.panX);
    setPanY(result.panY);
    setZoom(result.zoom);
  });
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
  abortTransientInput,
  mounted: () => observedSize() !== undefined,
  cameraSettled: () => !panAnimating(),
  viewportSize,
  viewportCenter,
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
