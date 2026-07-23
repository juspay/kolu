/** Real-mousemove gate for palette hover selection.
 *
 *  Opening the palette under a stationary cursor (or re-rendering rows under
 *  one) fires synthetic `mousemove` / `mouseenter` with unchanged coordinates.
 *  Honouring those steals keyboard selection and shimmers the row under the
 *  pointer. cmdk/Raycast-style palettes only enable hover after the pointer
 *  actually moves: seed the first position without activating, then require a
 *  coordinate delta. Keyboard navigation clears the active flag so selection
 *  stays on the key until the pointer moves again. */

export type PointerPos = { x: number; y: number };

/** Fold one mousemove into the gate. Returns whether hover selection may now
 *  follow the pointer, plus the updated last-seen position. */
export function notePointerMove(
  prev: PointerPos | null,
  next: PointerPos,
): { hoverArmed: boolean; pos: PointerPos } {
  if (prev === null) {
    // First event after open/reset — record coords, stay unarmed.
    return { hoverArmed: false, pos: next };
  }
  if (prev.x === next.x && prev.y === next.y) {
    // Zero-delta synthetic move (reflow / enter under stationary cursor).
    return { hoverArmed: false, pos: prev };
  }
  return { hoverArmed: true, pos: next };
}
