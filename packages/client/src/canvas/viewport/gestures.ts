/** Gesture input for the canvas — wheel pan/zoom and middle-mouse drag.
 *  Owns event listener lifecycle (AbortController cleanup).
 *  Emits pan/zoom deltas via callbacks; knows nothing about state or CSS. */

import { capturePointerGesture } from "./capturePointerGesture";
import { createWheelOwnership } from "./wheelOwnership";

const ZOOM_SPEED = 0.002;

export interface GestureCallbacks {
  /** Pan by a canvas-space delta (already divided by zoom). */
  onPan: (dx: number, dy: number) => void;
  /** Zoom by a factor at a screen-space point (relative to container). */
  onZoom: (factor: number, screenX: number, screenY: number) => void;
}

/** Install wheel and middle-mouse gesture listeners on a container element.
 *  Returns a cleanup function that removes all listeners.
 *
 *  `shouldYieldWheel`, if provided, is called on the first event of a wheel
 *  gesture; returning true lets the target scroll natively (no pan, no
 *  preventDefault). Ownership holds until ~150ms of wheel idle so cursor drift
 *  mid-gesture doesn't hand off. Ctrl/Cmd+wheel (zoom) always goes to the
 *  canvas regardless. */
export function installGestures(
  el: HTMLDivElement,
  callbacks: GestureCallbacks,
  shouldYieldWheel?: (e: WheelEvent) => boolean,
): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const ownership = shouldYieldWheel
    ? createWheelOwnership(shouldYieldWheel)
    : null;

  // Wheel: unmodified = pan (subject to ownership), ctrl/meta = zoom
  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const factor = 1 - e.deltaY * ZOOM_SPEED;
        callbacks.onZoom(factor, e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      if (ownership?.resolve(e) === "yielded") return;
      e.preventDefault();
      callbacks.onPan(e.deltaX, e.deltaY);
    },
    { passive: false, signal },
  );

  // Middle-mouse drag pan
  let abortPanDrag: (() => void) | null = null;

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      abortPanDrag?.();
      el.style.cursor = "grabbing";

      let lastX = e.clientX;
      let lastY = e.clientY;

      abortPanDrag = capturePointerGesture({
        onMove: (ev) => {
          callbacks.onPan(-(ev.clientX - lastX), -(ev.clientY - lastY));
          lastX = ev.clientX;
          lastY = ev.clientY;
        },
        onEnd: () => {
          abortPanDrag = null;
          el.style.cursor = "";
        },
      });
    },
    { signal },
  );

  return () => {
    abortPanDrag?.();
    ownership?.dispose();
    abort.abort();
  };
}
