/** Canvas viewport orchestrator — singleton state that wires together
 *  gesture input, transform math, and CSS coordinate generation.
 *
 *  Consumers import only this module. The three internal modules
 *  (gestures, transforms, coordinates) are implementation details. */

import type { Accessor } from "solid-js";
import { activeScope } from "../../hostScope/hostScopes";
import type { TileLayout } from "../TileLayout";
import { animatePan } from "./animatedPan";
import {
  canvasTransformCSS,
  gridBgPositionCSS,
  gridBgSizeCSS,
} from "./coordinates";
import { installGestures } from "./gestures";
import {
  accumulateZoom,
  applyGestureBatch,
  computeCenterPan,
  type GestureBatch,
  normalizeDelta as normalizeDeltaPure,
  snapToGrid as snapToGridPure,
  viewportCenter as viewportCenterPure,
  zoomToCenter as zoomToCenterPure,
} from "./transforms";

// ── Per-host camera state (read/written on the ACTIVE host's owner) ──
//
// The live pan/zoom is no longer three module-scope signals shared by every host
// (the camera bug's birthplace — bridged to per-host storage by the deleted
// `useCanvasCameraSwap` swap effect, a race a defer-guard could never close). It
// lives in the ACTIVE host's `scopedByEntry` owner (`hostScope/createCamera`), so
// switching hosts shows that host's RETAINED pose by construction — there is no
// restore step to race the incoming tile's mount, so "pans to empty" cannot arise.
// The per-canvas GESTURE / animation / container machinery below stays module
// scope (one active canvas at a time) and reads/writes whichever host is active
// through these accessors. During the removal race `cam()` is `undefined`: reads
// floor (0 / 1), writes no-op — `wire.ts` re-points `activeHost` a tick later.
const cam = () => activeScope()?.camera;
const panX = (): number => cam()?.panX() ?? 0;
const panY = (): number => cam()?.panY() ?? 0;
const zoom = (): number => cam()?.zoom() ?? 1;
// A pose write marks the host's camera `positioned` inside the setter itself
// (`hostScope/createCamera`) — the switch-in center decision (TerminalCanvas)
// reads that to pick "seed on the active tile" (a never-positioned host) vs.
// "keep the retained pose, re-center only if stale". `cam()` is `undefined` only
// during the removal race, so the optional-chain no-ops.
const setPanX = (v: number): void => cam()?.setPanX(v);
const setPanY = (v: number): void => cam()?.setPanY(v);
const setZoom = (v: number): void => cam()?.setZoom(v);

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
// the frame's pan delta (sum) and zoom (a per-event-clamped running factor,
// toward the last anchor) and apply them ONCE per rAF. For a pure-pan or
// pure-zoom frame — and a wheel event is pan XOR zoom, so a gesture is
// overwhelmingly one — the per-frame state is identical to the per-event path
// (`applyGestureBatch` telescopes the math, `accumulateZoom` clamps per event),
// so feel is unchanged. A frame that mixes both is a bounded, non-accumulating
// approximation (see `applyGestureBatch`). The per-event hot path mutates fields
// of the existing `pending` batch (zero allocation); the single `{ ...EMPTY }`
// clone happens only per-frame/per-discard.
const EMPTY: GestureBatch = {
  panDx: 0,
  panDy: 0,
  zoomFactor: 1,
  zoomAnchorX: 0,
  zoomAnchorY: 0,
};
let pending: GestureBatch = { ...EMPTY };
// Viewport zoom at the moment this frame's zoom accumulation began. Captured
// once per batch (when `pending.zoomFactor` is still 1) so per-event clamping
// in `accumulateZoom` is anchored to the same start the per-event path saw.
let zoomStart = 1;
let gestureRaf = 0;

function scheduleGestureFlush() {
  if (gestureRaf) return;
  gestureRaf = requestAnimationFrame(flushGesture);
}

function flushGesture() {
  gestureRaf = 0;
  const result = applyGestureBatch(panX(), panY(), zoom(), pending);
  pending = { ...EMPTY };
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
  pending = { ...EMPTY };
}

/** Abort any input still aimed at the host we are LEAVING — the in-flight pan
 *  tween AND the queued gesture delta. Both the animation callback and
 *  `flushGesture` write pan/zoom through `activeScope()` (module-scope machinery,
 *  one active canvas), so a frame-late callback that fires AFTER `activeHost`
 *  changed would land the outgoing host's motion in the INCOMING host's per-host
 *  camera. The active-host switch effect (`useCanvasCenterOnSwitch`) calls this up
 *  front so a switch cannot corrupt the retained pose of the host switched TO. */
function abortTransientInput() {
  cancelPanAnimation();
  discardPendingGesture();
}

/** Begin an authoritative absolute mutation: a programmatic write is the new
 *  truth, so it must kill BOTH competing input sources — the in-flight tween
 *  and the queued gesture delta. Every programmatic setter plugs into this one
 *  seam so it cannot forget half the arbitration. */
function beginAuthoritativeMutation() {
  abortTransientInput();
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
  /** Abort transient input aimed at the active host — the in-flight pan
   *  animation and any queued gesture flush. Called on an active-host switch so a
   *  frame-late callback cannot write the OUTGOING host's motion into the INCOMING
   *  host's per-host camera (the module-scope machinery writes through
   *  `activeScope()`, which re-keys to the new host on switch). */
  abortTransientInput: () => void;
  /** Current viewport dimensions in pixels (0×0 before mount). */
  viewportSize: () => { width: number; height: number };
  /** Canvas-space point at the viewport center — the forward projection of
   *  pan+zoom+size that consumers use to drop a tile under the camera. `null`
   *  before the container mounts (no real dimensions yet), mirroring
   *  `centerOnTile`/`panTo`: callers must guard rather than place at a bogus
   *  origin-derived point. */
  viewportCenter: () => { x: number; y: number } | null;
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
        pending.panDx += dx;
        pending.panDy += dy;
        scheduleGestureFlush();
      },
      onZoom: (factor, sx, sy) => {
        cancelPanAnimation();
        // First zoom contribution of this frame: anchor the running clamped
        // zoom to the live signal so per-event clamping matches the old path.
        if (pending.zoomFactor === 1) zoomStart = zoom();
        accumulateZoom(pending, zoomStart, factor);
        pending.zoomAnchorX = sx;
        pending.zoomAnchorY = sy;
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

function viewportCenter() {
  // Guard on the container like targetForPoint/targetForTile: without it,
  // viewportSize() falls back to 0×0 and the "center" collapses to the raw
  // pan origin — a silently wrong point. Return null so callers no-op.
  if (!containerEl) return null;
  const { width, height } = viewportSize();
  return viewportCenterPure(panX(), panY(), width, height, zoom());
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
  abortTransientInput,
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
