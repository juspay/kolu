import { GRID_SIZE, snapToGrid } from "./viewport/transforms";

export const DEFAULT_TILE_W = 800;
export const DEFAULT_TILE_H = 540;

const CASCADE_STEP = GRID_SIZE * 2;
const MAX_CASCADE_ITERATIONS = 50;

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
