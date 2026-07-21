/** Reusable pointer gesture lifecycle — wires pointermove/pointerup on
 *  `window` against the caller-supplied `AbortController`. Used by tile
 *  resize, middle-mouse pan, and minimap drag.
 *
 *  Caller owns the controller: pass a fresh one per gesture and call
 *  `.abort()` to cancel mid-gesture. `pointerup` ends the gesture (auto-abort +
 *  `onEnd`).
 *
 *  `onCancel` is OPT-IN, and the `pointercancel` listener is wired ONLY when a
 *  caller provides it — a caller that omits `onCancel` keeps the plain
 *  pointermove/pointerup lifecycle it always had (its own transient cleanup
 *  lives in `onEnd`, so silently aborting on `pointercancel` would strand that
 *  state). A caller that DOES provide `onCancel` opts into handling a
 *  platform-reclaimed pointer (a touch/pen the OS takes over, which fires
 *  `pointercancel` INSTEAD of `pointerup`): the gesture auto-aborts and runs
 *  `onCancel` — NEVER `onEnd` — so a cancelled gesture reverts / cleans up
 *  rather than committing.
 *
 *  Pass `pointerId` to bind the gesture to the pointer that started it: events
 *  from any OTHER pointer (a second touch/pen) are ignored, so they can't drive
 *  or prematurely end this gesture. Omit it for the legacy single-pointer
 *  behavior. */

export interface PointerGestureHandlers {
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
  /** Opt-in `pointercancel` handler. When present, a `pointercancel` aborts the
   *  gesture and runs this (not `onEnd`). When absent, no `pointercancel`
   *  listener is wired at all, so the caller's existing lifecycle is unchanged. */
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
  const { onCancel } = handlers;
  if (onCancel) {
    window.addEventListener(
      "pointercancel",
      (e) => {
        if (!mine(e)) return;
        // Cancelled gesture: tear down, then revert/clean up via onCancel —
        // NEVER onEnd, so a caller's commit path can't run on a cancel.
        abort.abort();
        onCancel(e);
      },
      { signal },
    );
  }
}
