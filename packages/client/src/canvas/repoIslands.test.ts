import { describe, expect, it } from "vitest";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { GRID_SIZE } from "./viewport/transforms";
import {
  arrangeRepoIslands,
  repackBucket,
  type RepoIslandTile,
} from "./repoIslands";

const TILE_GAP = GRID_SIZE;

function tile(
  id: string,
  bucket: string,
  layout: { x: number; y: number; w: number; h: number },
): RepoIslandTile {
  return { id, bucket, layout };
}

describe("arrangeRepoIslands", () => {
  it("returns empty map for empty input", () => {
    expect(arrangeRepoIslands([]).size).toBe(0);
  });

  it("packs same-bucket tiles into a square-ish grid", () => {
    const w = 96;
    const h = 72;
    const arranged = arrangeRepoIslands([
      tile("a", "kolu", { x: 0, y: 0, w, h }),
      tile("b", "kolu", { x: 500, y: 0, w, h }),
      tile("c", "kolu", { x: 0, y: 500, w, h }),
      tile("d", "kolu", { x: 500, y: 500, w, h }),
    ]);
    const a = arranged.get("a");
    const b = arranged.get("b");
    const c = arranged.get("c");
    const d = arranged.get("d");
    if (!a || !b || !c || !d) throw new Error("Expected all entries");
    // 2×2 grid: row 0 = a, b; row 1 = c, d. col 0 = a, c; col 1 = b, d.
    expect(a.y).toBe(b.y);
    expect(c.y).toBe(d.y);
    expect(a.x).toBe(c.x);
    expect(b.x).toBe(d.x);
    expect(b.x - (a.x + a.w)).toBe(TILE_GAP);
    expect(c.y - (a.y + a.h)).toBe(TILE_GAP);
  });

  it("packs separate buckets into distinct clusters", () => {
    const arranged = arrangeRepoIslands([
      tile("a", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
      tile("b", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
      tile("c", "beta", { x: 0, y: 0, w: 96, h: 72 }),
    ]);

    const a = arranged.get("a");
    const b = arranged.get("b");
    const c = arranged.get("c");
    if (!a || !b || !c) throw new Error("Expected all entries");
    expect(b.x - (a.x + a.w)).toBe(24);
    expect(b.y).toBe(a.y);
    expect(c.x - (b.x + b.w)).toBeGreaterThanOrEqual(768);
  });

  it("preserves each tile's width and height", () => {
    const arranged = arrangeRepoIslands([
      tile("a", "kolu", { x: 10, y: 20, w: 601, h: 421 }),
      tile("b", "kolu", { x: 900, y: 20, w: 523, h: 367 }),
      tile("c", "kolu", { x: 10, y: 900, w: 733, h: 511 }),
    ]);

    expect(arranged.get("a")).toMatchObject({ w: 601, h: 421 });
    expect(arranged.get("b")).toMatchObject({ w: 523, h: 367 });
    expect(arranged.get("c")).toMatchObject({ w: 733, h: 511 });
  });

  it("anchors output at the input bounding-box top-left", () => {
    const arranged = arrangeRepoIslands([
      tile("a", "kolu", { x: 288, y: 432, w: 96, h: 72 }),
      tile("b", "kolu", { x: 912, y: 120, w: 96, h: 72 }),
    ]);

    const a = arranged.get("a");
    if (!a) throw new Error("expected a");
    expect(a.x).toBe(288);
    expect(a.y).toBe(120);
  });

  it("is deterministic — same input produces the same output", () => {
    const tiles = [
      tile("a", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
      tile("b", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
      tile("c", "beta", { x: 0, y: 0, w: 96, h: 72 }),
      tile("d", "gamma", { x: 0, y: 0, w: 96, h: 72 }),
    ];
    const first = arrangeRepoIslands(tiles);
    const second = arrangeRepoIslands(tiles);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });
});

describe("repackBucket", () => {
  it("returns undefined when no matching island exists", () => {
    expect(
      repackBucket(
        "kolu",
        [tile("a", "other", { x: 0, y: 0, w: 800, h: 540 })],
        "new",
      ),
    ).toBeUndefined();
  });

  it("returns undefined when there are no existing tiles", () => {
    expect(repackBucket("kolu", [], "new")).toBeUndefined();
  });

  it("emits layouts for every same-bucket tile plus the new one", () => {
    const repacked = repackBucket(
      "kolu",
      [
        tile("a", "kolu", { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H }),
        tile("o", "other", { x: 5000, y: 5000, w: 200, h: 100 }),
      ],
      "new",
    );
    if (!repacked) throw new Error("Expected a layout map");
    expect([...repacked.keys()].sort()).toEqual(["a", "new"]);
  });

  it("places the new tile to the right when the bucket has a single tile (n=2 → 2×1)", () => {
    const repacked = repackBucket(
      "kolu",
      [
        tile("a", "kolu", {
          x: 96,
          y: 48,
          w: DEFAULT_TILE_W,
          h: DEFAULT_TILE_H,
        }),
      ],
      "new",
    );
    if (!repacked) throw new Error("Expected a layout map");
    const a = repacked.get("a");
    const next = repacked.get("new");
    if (!a || !next) throw new Error("Expected entries");
    // n=2, cols=ceil(sqrt(2))=2 → 2×1 row.
    expect(next.y).toBe(a.y);
    expect(next.x - (a.x + a.w)).toBe(TILE_GAP);
    expect(next.w).toBe(DEFAULT_TILE_W);
    expect(next.h).toBe(DEFAULT_TILE_H);
  });

  it("wraps the new tile below the first when n=3 (cols=2)", () => {
    const w = DEFAULT_TILE_W;
    const h = DEFAULT_TILE_H;
    const repacked = repackBucket(
      "kolu",
      [
        tile("a", "kolu", { x: 0, y: 0, w, h }),
        tile("b", "kolu", { x: w + TILE_GAP, y: 0, w, h }),
      ],
      "c",
    );
    if (!repacked) throw new Error("Expected a layout map");
    const a = repacked.get("a");
    const b = repacked.get("b");
    const c = repacked.get("c");
    if (!a || !b || !c) throw new Error("Expected entries");
    // 2×2 grid (3 tiles): a→(0,0), b→(w+gap,0), c→(0,h+gap).
    expect(c.x).toBe(a.x);
    expect(c.y - (a.y + a.h)).toBe(TILE_GAP);
    expect(c.y).toBeGreaterThan(b.y);
  });

  it("anchors at the bucket's current bounding-box top-left", () => {
    const repacked = repackBucket(
      "kolu",
      [
        tile("a", "kolu", {
          x: 1200,
          y: 720,
          w: DEFAULT_TILE_W,
          h: DEFAULT_TILE_H,
        }),
      ],
      "new",
    );
    if (!repacked) throw new Error("Expected a layout map");
    const a = repacked.get("a");
    if (!a) throw new Error("Expected a");
    // Single-tile cluster: existing tile keeps its position.
    expect(a.x).toBe(1200);
    expect(a.y).toBe(720);
  });

  it("orders existing tiles by current (y, x) so a row stays a row across re-pack", () => {
    const w = 200;
    const h = 100;
    // Existing tiles deliberately fed in reverse — repackBucket sorts
    // by (y, x) before slotting, so visual order is preserved.
    const repacked = repackBucket(
      "kolu",
      [
        tile("right", "kolu", { x: w + TILE_GAP, y: 0, w, h }),
        tile("left", "kolu", { x: 0, y: 0, w, h }),
      ],
      "next",
    );
    if (!repacked) throw new Error("Expected a layout map");
    const left = repacked.get("left");
    const right = repacked.get("right");
    if (!left || !right) throw new Error("Expected entries");
    expect(left.x).toBeLessThan(right.x);
    expect(left.y).toBe(right.y);
  });

  it("uses DEFAULT_TILE_W / DEFAULT_TILE_H for the new tile", () => {
    const repacked = repackBucket(
      "kolu",
      [tile("a", "kolu", { x: 0, y: 0, w: 200, h: 100 })],
      "new",
    );
    if (!repacked) throw new Error("Expected a layout map");
    expect(repacked.get("new")).toMatchObject({
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
    });
  });
});
