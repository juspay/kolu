/** Default placement policy for newly created canvas tiles.
 *
 *  A tile opens at the viewport center. If that snapped position already
 *  hosts another tile, it cascades diagonally until a free spot is found —
 *  opening two terminals without panning produces a staircase, not a stack.
 *
 *  `CASCADE_STEP` is a multiple of `GRID_SIZE` so `snapToGrid` can't collapse
 *  successive cascade steps onto the same coordinate. */

import { GRID_SIZE, snapToGrid } from "./viewport/transforms";

/** Default tile dimensions — 800×540 fits ~88 cols × 27 rows at the default
 *  font, safely above the legacy 80×24 baseline. */
export const DEFAULT_TILE_W = 800;
export const DEFAULT_TILE_H = 540;

const CASCADE_STEP = GRID_SIZE * 2;
const MAX_CASCADE_ITERATIONS = 50;

/** Find a free top-left for a new default-sized tile, starting at the viewport
 *  center and cascading diagonally if the spot is already taken. `existing`
 *  is the set of already-positioned tiles (saved + pending); only their
 *  top-left is compared, so callers must pass tiles of the same default
 *  dimensions for collision detection to be accurate. */
export function findFreeTilePosition(
  viewportCenterX: number,
  viewportCenterY: number,
  existing: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } {
  const occupied = new Set(existing.map((l) => `${l.x},${l.y}`));
  const baseX = viewportCenterX - DEFAULT_TILE_W / 2;
  const baseY = viewportCenterY - DEFAULT_TILE_H / 2;
  for (let i = 0; i < MAX_CASCADE_ITERATIONS; i++) {
    const x = snapToGrid(baseX + i * CASCADE_STEP);
    const y = snapToGrid(baseY + i * CASCADE_STEP);
    if (!occupied.has(`${x},${y}`)) return { x, y };
  }
  return { x: snapToGrid(baseX), y: snapToGrid(baseY) };
}
