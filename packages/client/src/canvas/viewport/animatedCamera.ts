/** Pure camera animation engine — no viewport coupling, no signals.
 *  Tweens a camera pose (pan + zoom) from `from` to `to` over `durationMs` via
 *  rAF, calling `onTick(panX, panY, zoom)` each frame. Cancel via the returned
 *  AbortController. Respects `prefers-reduced-motion` by jumping to the target
 *  in a single tick.
 *
 *  Zoom interpolates GEOMETRICALLY (constant ratio per unit time), not
 *  linearly: doubling and halving are the same size of visual change, so a
 *  linear ramp reads as a lurch that decelerates. This is what makes "focus a
 *  tile" (TR1's replacement for maximized mode) feel like flying rather than
 *  snapping. A pure pan — `from.zoom === to.zoom` — reduces to the old
 *  two-axis tween exactly, since the ratio is 1 at every t. */

export interface CameraPose {
  panX: number;
  panY: number;
  zoom: number;
}

export interface AnimateCameraOptions {
  durationMs?: number;
  easing?: (t: number) => number;
}

/** Pan-only moves keep the original snappy feel; a fly that also changes zoom
 *  travels further visually, so it gets a little longer to land. */
export const PAN_DURATION_MS = 150;
export const FLY_DURATION_MS = 220;

/** Symmetric ease-in-out quadratic. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Shared canvas motion gate — pan, land-in, finish-exhale all honor this. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function animateCamera(
  from: CameraPose,
  to: CameraPose,
  onTick: (panX: number, panY: number, zoom: number) => void,
  opts: AnimateCameraOptions = {},
): AbortController {
  const controller = new AbortController();
  const zooms = from.zoom !== to.zoom;
  const durationMs =
    opts.durationMs ?? (zooms ? FLY_DURATION_MS : PAN_DURATION_MS);
  const easing = opts.easing ?? easeInOutQuad;

  if (prefersReducedMotion() || durationMs <= 0) {
    onTick(to.panX, to.panY, to.zoom);
    controller.abort();
    return controller;
  }

  const start = performance.now();
  // Geometric ratio for the zoom leg (1 when the pose doesn't zoom).
  const zoomRatio = to.zoom / from.zoom;
  let raf = 0;

  function frame(now: number) {
    if (controller.signal.aborted) return;
    const t = Math.min(1, (now - start) / durationMs);
    const e = easing(t);
    onTick(
      from.panX + (to.panX - from.panX) * e,
      from.panY + (to.panY - from.panY) * e,
      from.zoom * zoomRatio ** e,
    );
    if (t < 1) raf = requestAnimationFrame(frame);
  }

  controller.signal.addEventListener("abort", () => cancelAnimationFrame(raf));
  raf = requestAnimationFrame(frame);
  return controller;
}
