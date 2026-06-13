/** Unit tests for `findFreeTilePosition` — the one-shot placement rule
 *  for new canvas tiles.
 *
 *  Two code paths: reference-tile (inherit size, place below, cascade on
 *  overlap) and viewport-center fallback (first tile, no active). */

import { describe, expect, it } from "vitest";
import {
  CANVAS_TILE_GAP,
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";
import type { TileLayout } from "./TileLayout";

const GAP = CANVAS_TILE_GAP;

function tile(x: number, y: number, w: number, h: number): TileLayout {
  return { x, y, w, h };
}

describe("findFreeTilePosition", () => {
  describe("with reference tile", () => {
    it("places directly below the reference, inheriting w and h", () => {
      const ref = tile(100, 200, 800, 600);
      const result = findFreeTilePosition(ref, []);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200 + 600 + GAP);
      expect(result.w).toBe(800);
      expect(result.h).toBe(600);
    });

    it("cascades downward when the first candidate overlaps a placed tile", () => {
      const ref = tile(0, 0, 800, 600);
      const blocker = tile(0, 600 + GAP, 800, 600);
      const result = findFreeTilePosition(ref, [ref, blocker]);
      expect(result.y).toBe(2 * (600 + GAP));
      expect(result.w).toBe(800);
      expect(result.h).toBe(600);
    });

    it("cascades through multiple blockers", () => {
      const ref = tile(0, 0, 400, 300);
      const b1 = tile(0, 300 + GAP, 400, 300);
      const b2 = tile(0, 2 * (300 + GAP), 400, 300);
      const result = findFreeTilePosition(ref, [ref, b1, b2]);
      expect(result.y).toBe(3 * (300 + GAP));
    });

    it("skips tiles at different x (no horizontal overlap)", () => {
      const ref = tile(0, 0, 800, 600);
      const sideTile = tile(1000, 600 + GAP, 800, 600);
      const result = findFreeTilePosition(ref, [ref, sideTile]);
      expect(result.y).toBe(600 + GAP);
    });

    it("detects partial horizontal overlap", () => {
      const ref = tile(0, 0, 800, 600);
      const partial = tile(700, 600 + GAP, 800, 600);
      const result = findFreeTilePosition(ref, [ref, partial]);
      expect(result.y).toBe(2 * (600 + GAP));
    });

    it("handles negative canvas coordinates", () => {
      const ref = tile(-500, -300, 800, 600);
      const result = findFreeTilePosition(ref, [ref]);
      expect(result.x).toBe(-500);
      expect(result.y).toBe(-300 + 600 + GAP);
    });
  });

  describe("without reference tile (fallback)", () => {
    it("centers on viewport with default dimensions", () => {
      const result = findFreeTilePosition(undefined, [], 500, 400);
      expect(result.x).toBe(500 - DEFAULT_TILE_W / 2);
      expect(result.y).toBe(400 - DEFAULT_TILE_H / 2);
      expect(result.w).toBe(DEFAULT_TILE_W);
      expect(result.h).toBe(DEFAULT_TILE_H);
    });

    it("cascades from viewport center when spots are taken", () => {
      const cx = 500;
      const cy = 400;
      const baseX = cx - DEFAULT_TILE_W / 2;
      const baseY = cy - DEFAULT_TILE_H / 2;
      const existing = [tile(baseX, baseY, DEFAULT_TILE_W, DEFAULT_TILE_H)];
      const result = findFreeTilePosition(undefined, existing, cx, cy);
      expect(result.x).not.toBe(baseX);
      expect(result.w).toBe(DEFAULT_TILE_W);
      expect(result.h).toBe(DEFAULT_TILE_H);
    });
  });
});
