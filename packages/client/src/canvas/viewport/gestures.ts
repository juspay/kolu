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

export interface GesturePolicy {
  /** Is this wheel gesture aimed at something that scrolls itself (a
   *  terminal)? True lets the target scroll natively — no pan, no
   *  preventDefault. */
  wheelTargetScrollsItself: (e: WheelEvent) => boolean;
  covered: () => boolean;
}

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

  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
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
