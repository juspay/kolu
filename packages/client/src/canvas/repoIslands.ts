/** Repo-island layout — pack tiles bucketed by `bucket` into square-ish
 *  clusters and pack the clusters across the canvas.
 *
 *  Two entry points serve two genuinely different operations:
 *
 *  - `arrangeRepoIslands(tiles)` is the one-shot palette command. It
 *    takes ALL tiles (each already placed) and returns a layout for
 *    every one. Same-bucket tiles cluster together; clusters lay out
 *    side-by-side. Each tile keeps its current `w` and `h` — this
 *    layout only moves, it doesn't resize.
 *
 *  - `placeNextToBucket(bucket, existing)` is the per-create policy.
 *    Given a new tile's bucket and the canvas's currently-placed tiles,
 *    return where to drop the new tile so it sits beside its bucket's
 *    existing island. Returns `undefined` when no matching island
 *    exists; callers fall back to the cascade default.
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

import type { TerminalId } from "kolu-common/surface";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import type { TileLayout } from "./TileLayout";
import { GRID_SIZE, snapToGrid } from "./viewport/transforms";

/** Tile input for the layout. `bucket` is the clustering key the caller
 *  projected (today: `terminalKey(meta).group`). `layout` is the tile's
 *  current effective layout — pending overrides merged with saved — so
 *  a tile mid-drag isn't seen as unplaced. */
export type RepoIslandTile = {
  id: TerminalId;
  bucket: string;
  layout: TileLayout;
};

const TILE_GAP = GRID_SIZE;
const CLUSTER_GAP = GRID_SIZE * 40;

/** Return desired layouts for every tile, packing same-bucket into
 *  square-ish clusters and packing clusters across the canvas. Each
 *  tile keeps its `w` and `h`. Anchored at the bounding-box top-left
 *  of the input layouts so an arrange doesn't teleport the workspace. */
export function arrangeRepoIslands(
  tiles: RepoIslandTile[],
): Map<TerminalId, TileLayout> {
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
  const result = new Map<TerminalId, TileLayout>();

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

/** Return a layout adjacent to the existing same-bucket island, or
 *  `undefined` when no matching island exists. Caller cascades on miss.
 *  Result tries (right of bucket bounding box, top-aligned); if it
 *  overlaps any existing tile, steps down a tile-row at a time. */
export function placeNextToBucket(
  bucket: string,
  existing: RepoIslandTile[],
): TileLayout | undefined {
  const bucketLayouts = existing
    .filter((t) => t.bucket === bucket)
    .map((t) => t.layout);
  if (bucketLayouts.length === 0) return undefined;

  const minY = Math.min(...bucketLayouts.map((l) => l.y));
  const maxX = Math.max(...bucketLayouts.map((l) => l.x + l.w));
  const allLayouts = existing.map((t) => t.layout);
  const verticalStep = ceilToGrid(DEFAULT_TILE_H + TILE_GAP);

  let candidate: TileLayout = {
    x: ceilToGrid(maxX + TILE_GAP),
    y: snapToGrid(minY),
    w: DEFAULT_TILE_W,
    h: DEFAULT_TILE_H,
  };
  for (let i = 0; i < 50; i++) {
    if (!allLayouts.some((l) => overlaps(candidate, l))) return candidate;
    candidate = { ...candidate, y: snapToGrid(candidate.y + verticalStep) };
  }
  return undefined;
}

function packCluster(tiles: RepoIslandTile[]): {
  layouts: Map<TerminalId, TileLayout>;
  w: number;
  h: number;
} {
  const offsets = packGrid(
    tiles.map((t) => ({ w: t.layout.w, h: t.layout.h })),
    TILE_GAP,
  );
  const layouts = new Map<TerminalId, TileLayout>();
  let maxRight = 0;
  let maxBottom = 0;
  tiles.forEach((tile, i) => {
    const offset = offsets[i] ?? { x: 0, y: 0 };
    const placed: TileLayout = {
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

/** Pack rectangles into a square-ish grid; return per-rect (x, y) offsets.
 *  Column widths and row heights are the per-track maxima so unequal
 *  rectangles don't overlap. */
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
    cursor = ceilToGrid(cursor + len + gap);
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

function ceilToGrid(v: number): number {
  return Math.ceil(v / GRID_SIZE) * GRID_SIZE;
}

function overlaps(a: TileLayout, b: TileLayout): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
