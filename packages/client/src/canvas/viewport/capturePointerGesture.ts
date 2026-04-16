/** Reusable pointer gesture lifecycle — captures pointer move/up events on
 *  `window` with automatic AbortController cleanup. Used by both tile resize
 *  and middle-mouse pan to avoid duplicating the same plumbing. */

export interface PointerGestureHandlers {
  onMove: (e: PointerEvent) => void;
  onEnd: (e: PointerEvent) => void;
}

/** Start capturing pointer events globally. Returns an abort function that
 *  removes all listeners. Calling `capture` again from the same call-site
 *  should abort the previous gesture first (caller's responsibility). */
export function capturePointerGesture(
  handlers: PointerGestureHandlers,
): () => void {
  const abort = new AbortController();
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

  return () => abort.abort();
}
