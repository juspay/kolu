import { describe, expect, it } from "vitest";
import { arrangeByRepo, type AutoArrangeTile } from "./autoArrange";

function tile(
  id: string,
  group: string,
  layout: { x: number; y: number; w: number; h: number },
): AutoArrangeTile {
  return { id, group, layout };
}

function randomSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("arrangeByRepo", () => {
  it("packs terminals from the same repo into a square-ish grid", () => {
    const arranged = arrangeByRepo(
      [
        tile("a", "kolu", { x: 0, y: 0, w: 96, h: 72 }),
        tile("b", "kolu", { x: 500, y: 0, w: 96, h: 72 }),
        tile("c", "kolu", { x: 0, y: 500, w: 96, h: 72 }),
        tile("d", "kolu", { x: 500, y: 500, w: 96, h: 72 }),
      ],
      { tileGap: 24, originX: 0, originY: 0 },
    );

    expect([...arranged.values()]).toEqual([
      { x: 0, y: 0, w: 96, h: 72 },
      { x: 120, y: 0, w: 96, h: 72 },
      { x: 0, y: 96, w: 96, h: 72 },
      { x: 120, y: 96, w: 96, h: 72 },
    ]);
  });

  it("packs repo clusters into a square-ish outer grid", () => {
    const arranged = arrangeByRepo(
      [
        tile("a", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
        tile("b", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
        tile("c", "beta", { x: 0, y: 0, w: 96, h: 72 }),
        tile("d", "gamma", { x: 0, y: 0, w: 96, h: 72 }),
        tile("e", "delta", { x: 0, y: 0, w: 96, h: 72 }),
      ],
      { tileGap: 24, groupGap: 48, groupJitter: 0, originX: 0, originY: 0 },
    );

    expect(arranged.get("a")).toEqual({ x: 0, y: 0, w: 96, h: 72 });
    expect(arranged.get("b")).toEqual({ x: 120, y: 0, w: 96, h: 72 });
    expect(arranged.get("c")).toEqual({ x: 264, y: 0, w: 96, h: 72 });
    expect(arranged.get("d")).toEqual({ x: 0, y: 120, w: 96, h: 72 });
    expect(arranged.get("e")).toEqual({ x: 264, y: 120, w: 96, h: 72 });
  });

  it("preserves current tile sizes", () => {
    const arranged = arrangeByRepo([
      tile("a", "kolu", { x: 10, y: 20, w: 601, h: 421 }),
      tile("b", "kolu", { x: 900, y: 20, w: 523, h: 367 }),
      tile("c", "kolu", { x: 10, y: 900, w: 733, h: 511 }),
    ]);

    expect(arranged.get("a")).toMatchObject({ w: 601, h: 421 });
    expect(arranged.get("b")).toMatchObject({ w: 523, h: 367 });
    expect(arranged.get("c")).toMatchObject({ w: 733, h: 511 });
  });

  it("defaults to compact same-repo spacing and island-like repo separation", () => {
    const arranged = arrangeByRepo(
      [
        tile("a", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
        tile("b", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
        tile("c", "beta", { x: 0, y: 0, w: 96, h: 72 }),
      ],
      { originX: 0, originY: 0 },
    );

    const first = arranged.get("a");
    const second = arranged.get("b");
    const otherRepo = arranged.get("c");
    if (!first || !second || !otherRepo) {
      throw new Error("Expected all arranged layouts to be present");
    }
    expect(first).toMatchObject({ w: 96, h: 72 });
    expect(second).toMatchObject({ w: 96, h: 72 });
    expect(otherRepo).toMatchObject({ w: 96, h: 72 });
    expect(second.x - (first.x + first.w)).toBe(24);
    expect(second.y).toBe(first.y);
    expect(otherRepo.x - (second.x + second.w)).toBeGreaterThanOrEqual(192);
    expect(first.x % 24).toBe(0);
    expect(otherRepo.x % 24).toBe(0);
  });

  it("can randomize repo island positions while keeping grid alignment", () => {
    const tiles = [
      tile("a", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
      tile("b", "alpha", { x: 0, y: 0, w: 96, h: 72 }),
      tile("c", "beta", { x: 0, y: 0, w: 96, h: 72 }),
    ];
    const plain = arrangeByRepo(tiles, {
      originX: 0,
      originY: 0,
      random: randomSequence([0, 0, 0, 0]),
    });
    const scattered = arrangeByRepo(tiles, {
      originX: 0,
      originY: 0,
      random: randomSequence([0, 0, 0.99, 0.99]),
    });

    expect(scattered.get("a")).toEqual(plain.get("a"));
    expect(scattered.get("b")).toEqual(plain.get("b"));
    expect(scattered.get("c")).toEqual({ x: 600, y: 96, w: 96, h: 72 });
  });

  it("anchors the arrangement at the existing bounding origin by default", () => {
    const arranged = arrangeByRepo([
      tile("a", "kolu", { x: 288, y: 432, w: 96, h: 72 }),
      tile("b", "kolu", { x: 912, y: 120, w: 96, h: 72 }),
    ]);

    expect(arranged.get("a")).toEqual({ x: 288, y: 120, w: 96, h: 72 });
  });
});
