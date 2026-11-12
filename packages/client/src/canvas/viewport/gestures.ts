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

/** What the canvas's owner knows and the gesture layer doesn't — two facts,
 *  read at event time, never cached. The gesture layer decides what to DO with
 *  them; the caller only answers them. */
export interface GesturePolicy {
  /** Is this wheel gesture aimed at something that scrolls itself (a
   *  terminal)? True lets the target scroll natively — no pan, no
   *  preventDefault. */
  wheelTargetScrollsItself: (e: WheelEvent) => boolean;
  /** Is the canvas covered right now (a maximized tile filling it)? A pinch
   *  over a covered canvas is swallowed: zooming what nobody can see is
   *  invisible state drift that surfaces later, when the canvas comes back at
   *  a scale the user never chose (#2354). Pan still moves the covered canvas
   *  — a pre-existing behaviour this answer deliberately doesn't touch. */
  covered: () => boolean;
}

/** Install wheel and pointer-drag gesture listeners on a container element.
 *  Returns a cleanup function that removes all listeners.
 *
 *  Pan ownership is decided once per wheel gesture via
 *  `policy.wheelTargetScrollsItself` and held until ~150ms of wheel idle, so
 *  cursor drift mid-gesture doesn't hand off. Ctrl/Cmd+wheel (zoom) is the
 *  canvas's regardless of target, and is always `preventDefault`ed — including
 *  when `policy.covered` swallows it — so the browser never magnifies the page
 *  instead.
 *
 *  Shift held on wheel or primary-button drag forces canvas pan ownership
 *  regardless of target (Figma-style hand tool). Shift ships on every
 *  WheelEvent/PointerEvent as `e.shiftKey`, so there's no caller-side
 *  keyboard tracking to plumb through — the gesture layer just reads it.
 *
 *  The wheel listener runs in capture phase so that when the canvas owns the
 *  gesture we can `stopPropagation()` before xterm (or any deeper listener)
 *  sees the event — otherwise a canvas-owned pan that drifts over a terminal
 *  would still scroll the terminal's buffer. The yielded path does not stop
 *  propagation, so the deeper listener runs naturally. */
export function installGestures(
  el: HTMLDivElement,
  callbacks: GestureCallbacks,
  policy: GesturePolicy,
): () => void {
  const abort = new AbortController();
  const { signal } = abort;

  let wheelOwner: WheelOwner | null = null;
  let wheelOwnerExpiresAt = 0;

  const yieldsWheel = (e: WheelEvent): boolean => {
    const now = performance.now();
    if (now >= wheelOwnerExpiresAt) wheelOwner = null;
    if (wheelOwner === null) {
      wheelOwner = policy.wheelTargetScrollsItself(e) ? "yielded" : "canvas";
    }
    wheelOwnerExpiresAt = now + WHEEL_IDLE_MS;
    return wheelOwner === "yielded";
  };

  // Wheel: unmodified = pan (subject to ownership), ctrl/meta = zoom
  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        // preventDefault FIRST and unconditionally: whatever we decide to do
        // with the pinch, the browser must not magnify the page over it.
        e.preventDefault();
        e.stopPropagation();
        if (policy.covered()) return;
        const rect = el.getBoundingClientRect();
        const factor = 1 - e.deltaY * ZOOM_SPEED;
        callbacks.onZoom(factor, e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      if (!e.shiftKey && yieldsWheel(e)) return;
      e.preventDefault();
      e.stopPropagation();
      callbacks.onPan(e.deltaX, e.deltaY);
    },
    { passive: false, capture: true, signal },
  );

  // Pan drag: middle-mouse, or Shift+primary-button.
  let abortPanDrag: AbortController | null = null;

  el.addEventListener(
    "pointerdown",
    (e) => {
      const isShiftPrimary = e.button === 0 && e.shiftKey;
      if (e.button !== 1 && !isShiftPrimary) return;
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
    // solid-dnd sensor) so Shift+primary-drag pans instead of selecting or
    // dragging a tile.
    { signal, capture: true },
  );

  return () => {
    abortPanDrag?.abort();
    abort.abort();
  };
}
