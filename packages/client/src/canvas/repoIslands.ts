import type { TerminalId } from "kolu-common/surface";
import type { TileLayout } from "./TileLayout";
import { GRID_SIZE } from "./viewport/transforms";

export type RepoIslandTile = {
  id: TerminalId;
  bucket: string;
  layout: TileLayout;
};

const TILE_GAP = GRID_SIZE;
const CLUSTER_GAP = GRID_SIZE * 40;

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
