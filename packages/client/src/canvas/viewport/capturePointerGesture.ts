/** Reusable pointer gesture lifecycle — wires pointermove/pointerup on
 *  `window` against the caller-supplied `AbortController`. Used by tile
 *  resize, middle-mouse pan, and minimap drag.
 *
 *  Caller owns the controller: pass a fresh one per gesture and call
 *  `.abort()` to cancel mid-gesture.
 *
 *  Both `pointerup` and `pointercancel` end the gesture (auto-abort), so a
 *  browser/OS-cancelled drag — a touch/pen the platform reclaims, which fires
 *  `pointercancel` INSTEAD of `pointerup` — can't strand the window listeners
 *  live (they'd otherwise keep firing `onMove` on every later pointer move until
 *  an eventual `pointerup` that may never come). A completed gesture runs
 *  `onEnd`; a cancelled one runs `onCancel` when given (else `onEnd`), so a
 *  caller can distinguish "commit" from "revert".
 *
 *  Pass `pointerId` to bind the gesture to the pointer that started it: events
 *  from any OTHER pointer (a second touch/pen) are ignored, so they can't drive
 *  or prematurely end this gesture. Omit it for the legacy single-pointer
 *  behavior. */

export interface PointerGestureHandlers {
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
  /** `pointercancel` handler. Defaults to `onEnd` when omitted. */
  onCancel?: (e: PointerEvent) => void;
}

export function capturePointerGesture(
  handlers: PointerGestureHandlers,
  abort: AbortController,
  pointerId?: number,
): void {
  const { signal } = abort;
  const mine = (e: PointerEvent) =>
    pointerId === undefined || e.pointerId === pointerId;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (mine(e)) handlers.onMove(e);
    },
    { signal },
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      if (!mine(e)) return;
      abort.abort();
      handlers.onEnd(e);
    },
    { signal },
  );
  window.addEventListener(
    "pointercancel",
    (e) => {
      if (!mine(e)) return;
      abort.abort();
      (handlers.onCancel ?? handlers.onEnd)(e);
    },
    { signal },
  );
}
