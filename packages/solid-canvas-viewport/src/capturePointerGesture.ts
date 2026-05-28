/** Reusable pointer gesture lifecycle — wires pointermove/pointerup on
 *  `window` against the caller-supplied `AbortController`. Used by tile
 *  resize, middle-mouse pan, and minimap drag.
 *
 *  Caller owns the controller: pass a fresh one per gesture and call
 *  `.abort()` to cancel mid-gesture. Pointerup also auto-aborts so
 *  listeners unwire as soon as the user releases. */

export interface PointerGestureHandlers {
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
}

export function capturePointerGesture(
  handlers: PointerGestureHandlers,
  abort: AbortController,
): void {
  const { signal } = abort;
  window.addEventListener("pointermove", handlers.onMove, { signal });
  window.addEventListener(
    "pointerup",
    (e) => {
      abort.abort();
      handlers.onEnd(e);
    },
    { signal },
  );
}
