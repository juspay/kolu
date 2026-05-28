/** `@kolu/canvas-layout` — pure 2D layout algorithms for a tiled-
 *  workspace canvas. No SolidJS, no DOM, no Kolu domain types — every
 *  function is a deterministic projection from `Rect[]` (and an optional
 *  bucketing key) to `Rect[]`. See `./README.md`. */

export { GRID_SIZE, snapToGrid } from "./canvasGeometry";
export {
  arrangeRepoIslands,
  type RepoIslandTile,
  repackBucket,
} from "./repoIslands";
export {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";
export type { Rect } from "./types";
