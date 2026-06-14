import { describe, expect, it } from "vitest";
import { type TileAura, tileAura } from "./tileAura";

type Bucket = Parameters<typeof tileAura>[0];

const cases: Array<[Bucket, boolean, boolean, TileAura]> = [
  // unread dominates the bucket — even a working tile reads "alert" when it
  // fired a missed alert the user hasn't focused yet, and unread beats stale.
  ["awaiting", true, false, "alert"],
  ["working", true, false, "alert"],
  ["none", true, false, "alert"],
  ["awaiting", true, true, "alert"],
  // !unread: bucket + age carry the state.
  ["awaiting", false, false, "waiting-fresh"],
  ["awaiting", false, true, "waiting-stale"], // a waiter cools as it ages
  ["working", false, false, "working"],
  ["working", false, true, "none"], // a stale worker parks — agrees with the dock
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
