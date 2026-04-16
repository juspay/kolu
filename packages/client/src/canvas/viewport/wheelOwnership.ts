/** Wheel-gesture ownership — decides whether the canvas or the wheel target
 *  owns a continuous scroll. Owner is set on the first event of a gesture and
 *  held through a short idle window so mid-gesture cursor drift doesn't hand
 *  off ownership.
 *
 *  Kept separate from gestures.ts so wheel sensing stays focused on pan/zoom
 *  math; ownership is a distinct sequence concern (Lowy volatility split). */

const IDLE_MS = 150;

export type WheelOwner = "canvas" | "yielded";

export interface WheelOwnership {
  /** Get the current owner, deciding on the first event of a gesture. */
  resolve: (e: WheelEvent) => WheelOwner;
  dispose: () => void;
}

export function createWheelOwnership(
  shouldYield: (e: WheelEvent) => boolean,
): WheelOwnership {
  let owner: WheelOwner | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      owner = null;
      idleTimer = null;
    }, IDLE_MS);
  };

  return {
    resolve(e) {
      if (owner === null) owner = shouldYield(e) ? "yielded" : "canvas";
      refreshIdle();
      return owner;
    },
    dispose() {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
      owner = null;
    },
  };
}
