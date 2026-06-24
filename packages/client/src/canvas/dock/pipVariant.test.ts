import type { PipVariant } from "@kolu/solid-statepip";
import { describe, expect, it } from "vitest";
import type { DockRowBucket } from "./dockRowRanking";
import { pipVariant } from "./pipVariant";

const cases: Array<[DockRowBucket, boolean, PipVariant]> = [
  // unread dominates the bucket — even working rows read as "attention"
  // when there's an unfinished alert the user hasn't seen.
  ["awaiting", true, "attention"],
  ["working", true, "attention"],
  ["idle", true, "attention"],
  ["none", true, "attention"],
  ["parked", true, "attention"],
  ["sleeping", true, "attention"],
  // !unread: bucket carries the state. awaiting is quiet (already seen);
  // working is the spinning ring; idle is muted; none/parked render empty.
  ["awaiting", false, "awaiting"],
  ["working", false, "working"],
  ["idle", false, "idle"],
  ["none", false, "empty"],
  ["parked", false, "empty"],
  // sleeping renders its own moonlit ☾ pip — never folded into idle/empty.
  ["sleeping", false, "sleeping"],
];

describe("pipVariant", () => {
  for (const [bucket, unread, expected] of cases) {
    it(`${bucket} + unread=${unread} → ${expected}`, () => {
      expect(pipVariant(bucket, unread)).toBe(expected);
    });
  }
});
