import { describe, expect, it } from "vitest";
import { type TileAura, tileAura } from "./tileAura";

type Bucket = Parameters<typeof tileAura>[0];

const cases: Array<[Bucket, boolean, boolean, TileAura]> = [
  ["awaiting", true, false, "alert"],
  ["working", true, false, "alert"],
  ["linger", true, false, "alert"],
  ["none", true, false, "alert"],
  ["awaiting", true, true, "alert"],
  ["awaiting", false, false, "waiting-fresh"],
  ["awaiting", false, true, "waiting-stale"],
  ["linger", false, false, "finished"],
  ["linger", false, true, "none"],
  ["working", false, false, "working"],
  ["working", false, true, "none"],
  ["none", false, false, "none"],
  ["none", false, true, "none"],
];

describe("tileAura", () => {
  for (const [bucket, unread, stale, expected] of cases) {
    it(`${bucket} + unread=${unread} + stale=${stale} → ${expected}`, () => {
      expect(tileAura(bucket, unread, stale)).toBe(expected);
    });
  }
});
