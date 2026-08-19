/** Decide whether a click is a content tap (file-ref / URL) or just
 *  focus / a drag. Same 10px threshold xterm used for tap-vs-scroll. */

export const TAP_THRESHOLD_PX = 10;

export interface TapGesture {
  startX: number;
  startY: number;
  focusedThisGesture: boolean;
  pointerType: string;
}

export function shouldActivateTap(
  gesture: TapGesture,
  endX: number,
  endY: number,
): boolean {
  if (
    Math.hypot(endX - gesture.startX, endY - gesture.startY) > TAP_THRESHOLD_PX
  ) {
    return false;
  }
  // A mouse/pen click that just focused the tile is activate-only.
  // Touch never focuses on pointerdown (soft keyboard), so a tap still
  // goes through onTap.
  if (gesture.pointerType !== "touch" && gesture.focusedThisGesture) {
    return false;
  }
  return true;
}
