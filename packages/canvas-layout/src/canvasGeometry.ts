/**
 * Canvas-geometry constants shared between viewport math and tile
 * packing.
 *
 * `GRID_SIZE` and `snapToGrid` defined here so the canvas's packing
 * algorithms (`repoIslands.ts` cluster packing, `tilePlacement.ts`
 * cascade) don't have to reach into `viewport/transforms.ts` for
 * them. The viewport module is internally responsible for converting
 * gestures + transforms to CSS; tile-space placement is a separate
 * concern that happens to share the same grid today.
 *
 * If tile-space and viewport-space ever need different grids,
 * `GRID_SIZE` splits along that axis with no transitive cleanup.
 */

/** Canvas-space grid resolution in CSS pixels. Tile coordinates and
 *  viewport pan/zoom both snap to this grid so layouts stay aligned
 *  across modes. */
export const GRID_SIZE = 24;

/** Snap a canvas-space coordinate to `GRID_SIZE`. Used by both the
 *  viewport (pan snap) and the tile-placement algorithms (cascade,
 *  cluster anchor). */
export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
