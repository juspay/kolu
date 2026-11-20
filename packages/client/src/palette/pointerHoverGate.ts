export type PointerPos = { x: number; y: number };

export function notePointerMove(
  prev: PointerPos | null,
  next: PointerPos,
): { hoverArmed: boolean; pos: PointerPos } {
  if (prev === null) {
    return { hoverArmed: false, pos: next };
  }
  if (prev.x === next.x && prev.y === next.y) {
    return { hoverArmed: false, pos: prev };
  }
  return { hoverArmed: true, pos: next };
}
