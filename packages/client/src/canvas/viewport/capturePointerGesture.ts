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
        abort.abort();
        onCancel(e);
      },
      { signal },
    );
  }
}
