/** Pure pan animation engine — no viewport coupling, no signals.
 *  Tweens a 2D point from `from` to `to` over `durationMs` via rAF,
 *  calling `onTick(x, y)` each frame. Cancel via the returned
 *  AbortController. Respects `prefers-reduced-motion` by jumping to
 *  the target in a single tick.
 *
 *  A TWEEN ALWAYS LANDS. Frames stop coming while a tab is in the
 *  background, so a flight begun just before the tab went away would
 *  otherwise sit half-finished for as long as the user is elsewhere — and its
 *  readers (`useCanvasViewport`'s `cameraSettled`, hence which tiles count as
 *  seen) would wait with it. Timers do keep running, throttled, so a guard
 *  timer jumps to the target and ends the tween if the frames never arrive. */

export interface Point {
  x: number;
  y: number;
}

export interface AnimatePanOptions {
  durationMs?: number;
  easing?: (t: number) => number;
  /** The tween reached its target (or jumped there under reduced motion).
   *  NOT called when the controller aborts — an aborted pan has no settled
   *  pose to report; its canceller owns what happens next. */
  onDone?: () => void;
}

const DEFAULT_DURATION_MS = 150;

/** A background tab clamps timers to about a second, so this is the shortest
 *  wait that reliably means "the frames are not coming back soon". */
const HIDDEN_TAB_GRACE_MS = 1_000;

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
    opts.onDone?.();
    return controller;
  }

  const start = performance.now();
  let raf = 0;
  let guard: ReturnType<typeof setTimeout> | undefined;
  let landed = false;

  /** The tween is over: stop both clocks and report ONCE. */
  function land() {
    if (landed) return;
    landed = true;
    clearTimeout(guard);
    cancelAnimationFrame(raf);
    opts.onDone?.();
  }

  function frame(now: number) {
    if (controller.signal.aborted) return;
    const t = Math.min(1, (now - start) / durationMs);
    const e = easing(t);
    onTick(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    if (t < 1) raf = requestAnimationFrame(frame);
    else land();
  }

  controller.signal.addEventListener("abort", () => {
    landed = true;
    clearTimeout(guard);
    cancelAnimationFrame(raf);
  });
  // Past the tween's own duration plus a background tab's ~1 s timer clamp,
  // no frame is coming that is going to finish this: put the camera where it
  // was going and be done.
  guard = setTimeout(() => {
    if (controller.signal.aborted || landed) return;
    onTick(to.x, to.y);
    land();
  }, durationMs + HIDDEN_TAB_GRACE_MS);
  raf = requestAnimationFrame(frame);
  return controller;
}
