/** Reusable pointer gesture lifecycle — wires pointermove/pointerup on
 *  `window` against the caller-supplied `AbortController`. Used by tile
 *  resize, middle-mouse pan, and minimap drag.
 *
 *  Caller owns the controller: pass a fresh one per gesture and call
 *  `.abort()` to cancel mid-gesture. Both `pointerup` AND `pointercancel`
 *  end the gesture (auto-abort + `onEnd`), so a browser/OS-cancelled drag —
 *  a touch/pen the platform reclaims, which fires `pointercancel` INSTEAD of
 *  `pointerup` — can't strand the window listeners live (they'd otherwise keep
 *  firing `onMove` on every later pointer move until an eventual `pointerup`
 *  that may never come). */

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
  const end = (e: PointerEvent) => {
    abort.abort();
    handlers.onEnd(e);
  };
  window.addEventListener("pointerup", end, { signal });
  window.addEventListener("pointercancel", end, { signal });
}
