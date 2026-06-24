import type { PipVariant } from "@kolu/solid-statepip";
import { describe, expect, it } from "vitest";
import type { DockRowBucket } from "./dockRowRanking";
import { pipVariant } from "./pipVariant";

// The bucket carries only the CORE state now — `unread` is no longer folded in
// (R-activity-merge moved it to the indicator's `alert` corner badge). awaiting is the
// quiet lingering dot; working is the spinning ring; idle is muted; none/parked
// render empty; sleeping is its own moonlit ☾ (never folded into idle/empty).
const cases: Array<[DockRowBucket, PipVariant]> = [
  ["awaiting", "awaiting"],
  ["working", "working"],
  ["idle", "idle"],
  ["none", "empty"],
  ["parked", "empty"],
  ["sleeping", "sleeping"],
];

describe("pipVariant", () => {
  for (const [bucket, expected] of cases) {
    it(`${bucket} → ${expected}`, () => {
      expect(pipVariant(bucket)).toBe(expected);
    });
  }
});
