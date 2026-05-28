# @kolu/canvas-layout

Pure 2D layout algorithms for a tiled-workspace canvas. No SolidJS,
no DOM, no Kolu domain types — every function is a deterministic
projection from `Rect[]` (and an optional bucketing key) to `Rect[]`.

## Exports

- `./geometry` — `GRID_SIZE`, `snapToGrid(value)`.
- `./repo-islands` — `arrangeRepoIslands(tiles)` and
  `repackBucket(bucket, existing, newTileId)` for square-ish
  per-bucket clusters laid out across the canvas.
- `./tile-placement` — `findFreeTilePosition(viewportCenterX,
  viewportCenterY, existing)` cascade for opening a new tile at a
  viewport-relative spot that doesn't already host another tile.

## Encapsulated axes

The "2D packing algorithm for grouped tiles" volatility axis has
already changed once in Kolu (from scatter to square-ish clusters)
and would change again under any of:

- Row-major vs column-major packing.
- Variable inter-cluster gap policy.
- Cluster shape (square-ish vs golden-ratio vs viewport-aspect).
- Per-bucket priority (today: input order; tomorrow: pinned-first).

`arrangeRepoIslands` + `packCluster` + `packGrid` are the closed
interior; consumers see a stable surface that takes `RepoIslandTile`
(`{ id, bucket, layout }`) and returns `Map<id, Rect>`.

## Why a package

Surface and `@kolu/solid-pierre` cleared the same single-in-tree-consumer
bar this package clears. The extraction is justified by volatility
encapsulation, not reuse count — pulling these algorithms out of
`packages/client/src/canvas/` removes a layering knot (`repoIslands`
depended on `viewport/transforms` for `GRID_SIZE` until cycle 6's
`canvasGeometry.ts` split) and makes the per-axis tests easier to
reason about. Future canvas-layout changes happen in one well-named
place instead of inside `client/`'s 6 600-LOC canvas subtree.
