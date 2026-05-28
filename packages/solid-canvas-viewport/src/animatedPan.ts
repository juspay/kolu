/** Pure pan animation engine — no viewport coupling, no signals.
 *  Tweens a 2D point from `from` to `to` over `durationMs` via rAF,
 *  calling `onTick(x, y)` each frame. Cancel via the returned
 *  AbortController. Respects `prefers-reduced-motion` by jumping to
 *  the target in a single tick. */

export interface Point {
  x: number;
  y: number;
}

export interface AnimatePanOptions {
  durationMs?: number;
  easing?: (t: number) => number;
}

const DEFAULT_DURATION_MS = 150;

/** Symmetric ease-in-out quadratic. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function animatePan(
  from: Point,
  to: Point,
  onTick: (x: number, y: number) => void,
  opts: AnimatePanOptions = {},
): AbortController {
  const controller = new AbortController();
  const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
  const easing = opts.easing ?? easeInOutQuad;

  if (prefersReducedMotion() || durationMs <= 0) {
    onTick(to.x, to.y);
    controller.abort();
    return controller;
  }

  const start = performance.now();
  let raf = 0;

  function frame(now: number) {
    if (controller.signal.aborted) return;
    const t = Math.min(1, (now - start) / durationMs);
    const e = easing(t);
    onTick(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    if (t < 1) raf = requestAnimationFrame(frame);
  }

  controller.signal.addEventListener("abort", () => cancelAnimationFrame(raf));
  raf = requestAnimationFrame(frame);
  return controller;
}
