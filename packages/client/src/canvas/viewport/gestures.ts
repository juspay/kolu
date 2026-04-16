/** Gesture input for the canvas — wheel pan/zoom and middle-mouse drag.
 *  Owns event listener lifecycle (AbortController cleanup).
 *  Emits pan/zoom deltas via callbacks; knows nothing about state or CSS. */

const ZOOM_SPEED = 0.002;

export interface GestureCallbacks {
  /** Pan by a canvas-space delta (already divided by zoom). */
  onPan: (dx: number, dy: number) => void;
  /** Zoom by a factor at a screen-space point (relative to container). */
  onZoom: (factor: number, screenX: number, screenY: number) => void;
}

/** Install wheel and middle-mouse gesture listeners on a container element.
 *  Returns a cleanup function that removes all listeners. */
export function installGestures(
  el: HTMLDivElement,
  callbacks: GestureCallbacks,
): () => void {
  const abort = new AbortController();
  const { signal } = abort;

  // Wheel: unmodified = pan, ctrl/meta = zoom
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const factor = 1 - e.deltaY * ZOOM_SPEED;
        callbacks.onZoom(factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        callbacks.onPan(e.deltaX, e.deltaY);
      }
    },
    { passive: false, signal },
  );

  // Middle-mouse drag pan
  let panDragAbort: AbortController | null = null;

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      panDragAbort?.abort();
      panDragAbort = new AbortController();
      const dragSignal = panDragAbort.signal;
      const startX = e.clientX;
      const startY = e.clientY;
      el.style.cursor = "grabbing";

      // Track cumulative delta so each move is relative to start
      let lastX = startX;
      let lastY = startY;

      window.addEventListener(
        "pointermove",
        (ev) => {
          callbacks.onPan(-(ev.clientX - lastX), -(ev.clientY - lastY));
          lastX = ev.clientX;
          lastY = ev.clientY;
        },
        { signal: dragSignal },
      );
      window.addEventListener(
        "pointerup",
        () => {
          panDragAbort?.abort();
          panDragAbort = null;
          el.style.cursor = "";
        },
        { signal: dragSignal },
      );
    },
    { signal },
  );

  return () => {
    panDragAbort?.abort();
    abort.abort();
  };
}
