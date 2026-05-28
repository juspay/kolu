/** Repo-island layout — pack tiles bucketed by `bucket` into square-ish
 *  clusters and pack the clusters across the canvas.
 *
 *  Two entry points:
 *  - `arrangeRepoIslands(tiles)` — palette command; lays out all tiles.
 *  - `repackBucket(bucket, existing, newTileId)` — per-create policy;
 *    re-lays out one bucket to include the new tile.
 *
 *  Both go through `packCluster`/`packGrid` so the per-create path
 *  produces the same square-ish shape as a full arrange.
 *
 *  Why `bucket: string` instead of `group: string`: the function only
 *  needs an opaque bucketing key. Today the caller projects from
 *  `terminalKey(meta).group`, but a future tiler that buckets by
 *  workspace, container-id, or pinned-region passes its own thing. Same
 *  parameter, no concept fork.
 *
 *  Pure and deterministic: same `tiles` input produces the same output
 *  every call. No randomness — a continuous re-layout would flicker if
 *  the function jittered. */

import { GRID_SIZE, snapToGrid } from "./canvasGeometry";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import type { Rect } from "./types";

/** Tile input for the layout. `bucket` is the clustering key the caller
 *  projected (today: `terminalKey(meta).group`). `layout` is the tile's
 *  current effective layout — pending overrides merged with saved — so
 *  a tile mid-drag isn't seen as unplaced. */
export type RepoIslandTile = {
  id: string;
  bucket: string;
  layout: Rect;
};

const TILE_GAP = GRID_SIZE;
// 960 px — comfortably wider than a default tile so repo islands read
// as separate clusters on the canvas, not as one wider grid.
const CLUSTER_GAP = GRID_SIZE * 40;

/** Return desired layouts for every tile, packing same-bucket into
 *  square-ish clusters and packing clusters across the canvas. Each
 *  tile keeps its `w` and `h`. Anchored at the bounding-box top-left
 *  of the input layouts so an arrange doesn't teleport the workspace. */
export function arrangeRepoIslands(tiles: RepoIslandTile[]): Map<string, Rect> {
  if (tiles.length === 0) return new Map();

  const buckets = groupBy(tiles, (t) => t.bucket);
  const clusters = [...buckets.entries()].map(([bucket, items]) => ({
    bucket,
    ...packCluster(items),
  }));
  const clusterRects = clusters.map((c) => ({ w: c.w, h: c.h }));
  const clusterOffsets = packGrid(clusterRects, CLUSTER_GAP);

  const originX = Math.min(...tiles.map((t) => t.layout.x));
  const originY = Math.min(...tiles.map((t) => t.layout.y));
  const result = new Map<string, Rect>();

  clusters.forEach((cluster, i) => {
    const offset = clusterOffsets[i] ?? { x: 0, y: 0 };
    for (const [id, layout] of cluster.layouts) {
      result.set(id, {
        ...layout,
        x: originX + offset.x + layout.x,
        y: originY + offset.y + layout.y,
      });
    }
  });

  return result;
}

/** Repack the bucket's island to include `newTileId` in a square-ish
 *  grid, anchored at the bucket's current bounding-box top-left.
 *  Returns `undefined` when no matching island exists.
 *
 *  Existing tiles keep their slots while the column count is stable;
 *  when n+1 forces a new column count (e.g. 4→5 grows from 2×2 to 3×2)
 *  they shift — that's the trade for "always square-ish". */
export function repackBucket(
  bucket: string,
  existing: RepoIslandTile[],
  newTileId: string,
): Map<string, Rect> | undefined {
  const bucketTiles = existing.filter((t) => t.bucket === bucket);
  if (bucketTiles.length === 0) return undefined;

  const ordered = [...bucketTiles].sort((a, b) =>
    a.layout.y !== b.layout.y
      ? a.layout.y - b.layout.y
      : a.layout.x - b.layout.x,
  );
  const newTile: RepoIslandTile = {
    id: newTileId,
    bucket,
    layout: { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H },
  };
  const { layouts } = packCluster([...ordered, newTile]);
  const anchorX = snapToGrid(Math.min(...bucketTiles.map((t) => t.layout.x)));
  const anchorY = snapToGrid(Math.min(...bucketTiles.map((t) => t.layout.y)));

  const result = new Map<string, Rect>();
  for (const [id, layout] of layouts) {
    result.set(id, {
      ...layout,
      x: anchorX + layout.x,
      y: anchorY + layout.y,
    });
  }
  return result;
}

/** Pack tiles into a square-ish grid anchored at (0, 0). Returned
 *  layouts are zero-based offsets — callers own anchoring and
 *  grid-snapping. */
function packCluster(tiles: RepoIslandTile[]): {
  layouts: Map<string, Rect>;
  w: number;
  h: number;
} {
  const offsets = packGrid(
    tiles.map((t) => ({ w: t.layout.w, h: t.layout.h })),
    TILE_GAP,
  );
  const layouts = new Map<string, Rect>();
  let maxRight = 0;
  let maxBottom = 0;
  tiles.forEach((tile, i) => {
    const offset = offsets[i] ?? { x: 0, y: 0 };
    const placed: Rect = {
      x: offset.x,
      y: offset.y,
      w: tile.layout.w,
      h: tile.layout.h,
    };
    layouts.set(tile.id, placed);
    maxRight = Math.max(maxRight, placed.x + placed.w);
    maxBottom = Math.max(maxBottom, placed.y + placed.h);
  });
  return { layouts, w: maxRight, h: maxBottom };
}

/** Pack rectangles into a square-ish grid; return per-rect (x, y) offsets
 *  anchored at (0, 0). Column widths and row heights are the per-track
 *  maxima so unequal rectangles don't overlap; the gap between adjacent
 *  rects is exactly `gap` regardless of rect dimensions (no implicit
 *  grid-snapping inside the cumulative offset). The returned array is
 *  the same length as the input and aligned by index — callers (e.g.
 *  `packCluster`) zip it with the originals; reordering or filtering
 *  inside this function would silently misassign geometry. */
function packGrid(
  rects: { w: number; h: number }[],
  gap: number,
): { x: number; y: number }[] {
  if (rects.length === 0) return [];
  const cols = Math.ceil(Math.sqrt(rects.length));
  const rows = Math.ceil(rects.length / cols);
  const colW = Array.from({ length: cols }, () => 0);
  const rowH = Array.from({ length: rows }, () => 0);
  rects.forEach((r, i) => {
    const c = i % cols;
    const rr = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, r.w);
    rowH[rr] = Math.max(rowH[rr] ?? 0, r.h);
  });
  const colX = trackOffsets(colW, gap);
  const rowY = trackOffsets(rowH, gap);
  return rects.map((_, i) => ({
    x: colX[i % cols] ?? 0,
    y: rowY[Math.floor(i / cols)] ?? 0,
  }));
}

function trackOffsets(lengths: number[], gap: number): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const len of lengths) {
    out.push(cursor);
    cursor += len + gap;
  }
  return out;
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
