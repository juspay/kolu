/** Default placement policy for newly created canvas tiles.
 *
 *  Two modes:
 *
 *  1. **Reference-tile mode** (active tile exists): inherit its size, place
 *     directly below it. If that position overlaps another tile, cascade
 *     downward by `h + CANVAS_TILE_GAP` until a free spot is found. This keeps same-
 *     project terminals stacked in a predictable column without hiding
 *     existing content — floating-window feel on an infinite canvas.
 *
 *  2. **Viewport-center fallback** (no active tile): center on the viewport
 *     with default dimensions, cascading diagonally if taken. Same as the
 *     legacy behavior — first tile, or orphan tile with no reference.
 *
 *  `CANVAS_TILE_GAP` is the single source of truth for tile-to-tile
 *   spacing across create-time placement and repo-island auto-arrange. */

import { GRID_SIZE } from "./viewport/transforms";
import type { TileLayout } from "./TileLayout";

export const DEFAULT_TILE_W = 800;
export const DEFAULT_TILE_H = 540;

/** Visual spacing between canvas tiles — shared by create-time placement
 *  and repo-island auto-arrange so a design change to canvas breathing
 *  room updates every tile-to-tile gap uniformly. */
export const CANVAS_TILE_GAP = GRID_SIZE;
const MAX_CASCADE_ITERATIONS = 50;

/** Find a free layout for a new tile. With a reference tile, inherits its
 *  size and places below it (cascading on overlap). Without, falls back
 *  to viewport-center placement at default size.
 *
 *  `placed` is every tile already positioned (saved + pending + newly
 *  placed in the same batch). Full rect intersection — not just top-left
 *  equality — so tiles of different widths are detected correctly.
 *
 *  Viewport-relative — only correct for one-shot placement at create time.
 *  A future continuous tiler must compute placement in a viewport-
 *  independent frame; pan would otherwise re-place tiles every frame. */
export function findFreeTilePosition(
  reference: TileLayout | undefined,
  placed: ReadonlyArray<TileLayout>,
  viewportCenterX?: number,
  viewportCenterY?: number,
): TileLayout {
  if (reference) {
    return placeBelowReference(reference, placed);
  }
  return placeAtViewportCenter(
    placed,
    viewportCenterX ?? 0,
    viewportCenterY ?? 0,
  );
}

function placeBelowReference(
  reference: TileLayout,
  placed: ReadonlyArray<TileLayout>,
): TileLayout {
  const refBottom = reference.y + reference.h + CANVAS_TILE_GAP;
  const step = reference.h + CANVAS_TILE_GAP;
  for (let i = 0; i < MAX_CASCADE_ITERATIONS; i++) {
    const candidate: TileLayout = {
      x: reference.x,
      y: refBottom + step * i,
      w: reference.w,
      h: reference.h,
    };
    if (!placed.some((p) => rectsOverlap(candidate, p))) {
      return candidate;
    }
  }
  return {
    x: reference.x,
    y: refBottom,
    w: reference.w,
    h: reference.h,
  };
}

function placeAtViewportCenter(
  placed: ReadonlyArray<TileLayout>,
  cx: number,
  cy: number,
): TileLayout {
  const baseX = cx - DEFAULT_TILE_W / 2;
  const baseY = cy - DEFAULT_TILE_H / 2;
  const step = GRID_SIZE * 2;
  for (let i = 0; i < MAX_CASCADE_ITERATIONS; i++) {
    const candidate: TileLayout = {
      x: baseX + i * step,
      y: baseY + i * step,
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
    };
    if (!placed.some((p) => rectsOverlap(candidate, p))) {
      return candidate;
    }
  }
  return { x: baseX, y: baseY, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
