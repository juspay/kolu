/** Gesture input for the canvas — wheel pan/zoom and pointer-drag pan.
 *  Owns event listener lifecycle (AbortController cleanup) and the wheel-
 *  ownership state machine that decides whether a continuous scroll belongs
 *  to the canvas (pan) or the target underneath (native scroll).
 *  Emits pan/zoom deltas via callbacks; knows nothing about state or CSS. */

import { capturePointerGesture } from "./capturePointerGesture";

const ZOOM_SPEED = 0.002;
const WHEEL_IDLE_MS = 150;

type WheelOwner = "canvas" | "yielded";

export interface GestureCallbacks {
  /** Pan by a canvas-space delta (already divided by zoom). */
  onPan: (dx: number, dy: number) => void;
  /** Zoom by a factor at a screen-space point (relative to container). */
  onZoom: (factor: number, screenX: number, screenY: number) => void;
}

/** Install wheel and pointer-drag gesture listeners on a container element.
 *  Returns a cleanup function that removes all listeners.
 *
 *  `shouldYieldWheel`, if provided, is called on the first event of a wheel
 *  gesture; returning true lets the target scroll natively (no pan, no
 *  preventDefault). Ownership holds until ~150ms of wheel idle so cursor drift
 *  mid-gesture doesn't hand off. Ctrl/Cmd+wheel (zoom) always goes to the
 *  canvas regardless.
 *
 *  `isPanModifier`, if provided, is an opaque boolean accessor the caller
 *  uses to assert that the canvas owns all pan gestures right now — regardless
 *  of target or ownership state. While it returns true: wheel always pans
 *  (no yield), and primary-button drag starts a pan gesture (like middle-mouse).
 *  The gesture layer knows nothing about what triggers the modifier (today:
 *  Space key); that's the caller's concern.
 *
 *  The wheel listener runs in capture phase so that when the canvas owns the
 *  gesture we can `stopPropagation()` before xterm (or any deeper listener)
 *  sees the event — otherwise a canvas-owned pan that drifts over a terminal
 *  would still scroll the terminal's buffer. The yielded path does not stop
 *  propagation, so the deeper listener runs naturally. */
export function installGestures(
  el: HTMLDivElement,
  callbacks: GestureCallbacks,
  shouldYieldWheel?: (e: WheelEvent) => boolean,
  isPanModifier?: () => boolean,
): () => void {
  const abort = new AbortController();
  const { signal } = abort;

  let wheelOwner: WheelOwner | null = null;
  let wheelOwnerExpiresAt = 0;

  const yieldsWheel = (e: WheelEvent): boolean => {
    if (!shouldYieldWheel) return false;
    const now = performance.now();
    if (now >= wheelOwnerExpiresAt) wheelOwner = null;
    if (wheelOwner === null) {
      wheelOwner = shouldYieldWheel(e) ? "yielded" : "canvas";
    }
    wheelOwnerExpiresAt = now + WHEEL_IDLE_MS;
    return wheelOwner === "yielded";
  };

  // Wheel: unmodified = pan (subject to ownership), ctrl/meta = zoom
  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const rect = el.getBoundingClientRect();
        const factor = 1 - e.deltaY * ZOOM_SPEED;
        callbacks.onZoom(factor, e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      if (!isPanModifier?.() && yieldsWheel(e)) return;
      e.preventDefault();
      e.stopPropagation();
      callbacks.onPan(e.deltaX, e.deltaY);
    },
    { passive: false, capture: true, signal },
  );

  // Pan drag: middle-mouse, or primary-button while the caller's pan modifier
  // is held (Space-to-pan).
  let abortPanDrag: AbortController | null = null;

  el.addEventListener(
    "pointerdown",
    (e) => {
      const isPrimaryPanModifier = e.button === 0 && isPanModifier?.() === true;
      if (e.button !== 1 && !isPrimaryPanModifier) return;
      e.preventDefault();
      e.stopPropagation();
      abortPanDrag?.abort();
      el.style.cursor = "grabbing";

      let lastX = e.clientX;
      let lastY = e.clientY;

      abortPanDrag = new AbortController();
      capturePointerGesture(
        {
          onMove: (ev) => {
            callbacks.onPan(-(ev.clientX - lastX), -(ev.clientY - lastY));
            lastX = ev.clientX;
            lastY = ev.clientY;
          },
          onEnd: () => {
            abortPanDrag = null;
            el.style.cursor = "";
          },
        },
        abortPanDrag,
      );
    },
    // Capture phase: pan claim fires before deeper listeners (tile onMouseDown,
    // solid-dnd sensor) so Space+primary-drag pans instead of selecting or
    // dragging a tile.
    { signal, capture: true },
  );

  return () => {
    abortPanDrag?.abort();
    abort.abort();
  };
}
