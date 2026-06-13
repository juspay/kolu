import { describe, expect, it } from "vitest";
import type { AgentBucketKind } from "./dockModel";
import { type TileAura, tileAura } from "./tileAura";

type Bucket = Exclude<AgentBucketKind, "idle">;

const cases: Array<[Bucket, boolean, boolean, TileAura]> = [
  // unread dominates the bucket and staleness — a missed alert reads loud
  // even if the agent has since moved on.
  ["awaiting", true, false, "alert"],
  ["working", true, false, "alert"],
  ["none", true, false, "alert"],
  ["awaiting", true, true, "alert"],
  // !unread: an awaiting tile splits by staleness — fresh is loud, stale
  // cools to the ember below the working hum.
  ["awaiting", false, false, "waiting"],
  ["awaiting", false, true, "waiting-stale"],
  // a fresh working tile hums; once it goes stale it is parked — drops to
  // `none`, matching the dock's `parked` bucket and the minimap ghost.
  ["working", false, false, "working"],
  ["working", false, true, "none"],
  // no agent → no bar.
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
