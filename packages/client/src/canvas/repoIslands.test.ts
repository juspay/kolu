import { describe, expect, it } from "vitest";
import {
  arrangeRepoIslands,
  placeNextToBucket,
  type RepoIslandTile,
} from "./repoIslands";

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
    const arranged = arrangeRepoIslands([
      tile("a", "kolu", { x: 0, y: 0, w: 96, h: 72 }),
      tile("b", "kolu", { x: 500, y: 0, w: 96, h: 72 }),
      tile("c", "kolu", { x: 0, y: 500, w: 96, h: 72 }),
      tile("d", "kolu", { x: 500, y: 500, w: 96, h: 72 }),
    ]);

    expect([...arranged.values()]).toEqual([
      { x: 0, y: 0, w: 96, h: 72 },
      { x: 120, y: 0, w: 96, h: 72 },
      { x: 0, y: 96, w: 96, h: 72 },
      { x: 120, y: 96, w: 96, h: 72 },
    ]);
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

describe("placeNextToBucket", () => {
  it("places adjacent to a single-tile island", () => {
    const layout = placeNextToBucket("kolu", [
      tile("a", "kolu", { x: 96, y: 48, w: 300, h: 200 }),
      tile("b", "other", { x: 2000, y: 2000, w: 300, h: 200 }),
    ]);
    expect(layout).toEqual({ x: 432, y: 48, w: 800, h: 540 });
  });

  it("uses the entire matching island as the anchor", () => {
    const layout = placeNextToBucket("kolu", [
      tile("a", "kolu", { x: 0, y: 240, w: 800, h: 540 }),
      tile("b", "kolu", { x: 840, y: 0, w: 640, h: 360 }),
    ]);
    expect(layout).toEqual({ x: 1512, y: 0, w: 800, h: 540 });
  });

  it("steps down when the adjacent slot is taken", () => {
    const layout = placeNextToBucket("kolu", [
      tile("a", "kolu", { x: 0, y: 0, w: 800, h: 540 }),
      tile("b", "other", { x: 840, y: 0, w: 800, h: 540 }),
    ]);
    expect(layout).toEqual({ x: 840, y: 576, w: 800, h: 540 });
  });

  it("returns undefined when no matching island exists", () => {
    expect(
      placeNextToBucket("kolu", [
        tile("a", "other", { x: 0, y: 0, w: 800, h: 540 }),
      ]),
    ).toBeUndefined();
  });

  it("returns undefined when there are no existing tiles", () => {
    expect(placeNextToBucket("kolu", [])).toBeUndefined();
  });
});
