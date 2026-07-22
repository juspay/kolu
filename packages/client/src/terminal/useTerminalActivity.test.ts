/**
 * Client live-set frame diff — the sticky-live fence. `useTerminalActivity`
 * reconciles each host's `activity` stream frame into a per-id live map; if
 * `prev` is a Solid reconcile proxy (not a plain copy), removals never apply and
 * every once-live terminal stays lit forever. This pure helper is what the
 * effect runs; the mirror only wires host streams into it.
 */

import { describe, expect, it } from "vitest";
import type { TerminalId } from "kolu-common/surface";
import { activityFrameDiff } from "./useTerminalActivity";

const A = "t-a" as TerminalId;
const B = "t-b" as TerminalId;

describe("activityFrameDiff", () => {
  it("adds newly live ids", () => {
    expect(activityFrameDiff([], [A, B])).toEqual({
      adds: [A, B],
      removes: [],
    });
  });

  it("removes ids that left the live set (live → empty clears)", () => {
    expect(activityFrameDiff([A, B], [])).toEqual({
      adds: [],
      removes: [A, B],
    });
  });

  it("diffs a churn (one stays, one leaves, one enters)", () => {
    expect(activityFrameDiff([A, B], [A, "t-c" as TerminalId])).toEqual({
      adds: ["t-c" as TerminalId],
      removes: [B],
    });
  });

  it("no-ops when the set is unchanged (order-insensitive for membership)", () => {
    expect(activityFrameDiff([A, B], [B, A])).toEqual({
      adds: [],
      removes: [],
    });
  });
});
