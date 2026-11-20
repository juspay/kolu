export interface Point {
  x: number;
  y: number;
}

export interface AnimatePanOptions {
  durationMs?: number;
  easing?: (t: number) => number;
  /** The tween reached its target — including the reduced-motion jump, which
   *  aborts the controller only because there is nothing left to cancel. A
   *  tween somebody else CANCELS reports nothing: its canceller owns what
   *  happens next. */
  onDone?: () => void;
}

const DEFAULT_DURATION_MS = 150;

/** A background tab clamps timers to about a second, so this is the shortest
 *  wait that reliably means "the frames are not coming back soon". */
const HIDDEN_TAB_GRACE_MS = 1_000;

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

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

  function stop() {
    landed = true;
    clearTimeout(guard);
    cancelAnimationFrame(raf);
  }

  function land() {
    if (landed) return;
    stop();
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

  controller.signal.addEventListener("abort", stop);
  guard = setTimeout(() => {
    if (landed) return;
    onTick(to.x, to.y);
    land();
  }, durationMs + HIDDEN_TAB_GRACE_MS);
  raf = requestAnimationFrame(frame);
  return controller;
}
