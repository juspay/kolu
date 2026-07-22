/**
 * Client live-set frame diff — the sticky-live fence. `useTerminalActivity`
 * reconciles each host's `activity` stream frame into a per-id live map; if
 * `prev` is a Solid reconcile proxy (not a plain copy), removals never apply and
 * every once-live terminal stays lit forever. This pure helper is what the
 * effect runs; the mirror only wires host streams into it.
 */

import { describe, expect, it } from "vitest";
import type { TerminalId } from "kolu-common/surface";
import {
  activityFrameDiff,
  createActivityFrameReducer,
} from "./useTerminalActivity";

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

describe("createActivityFrameReducer", () => {
  it("clears a live id when its host frame goes empty (live → empty → not live)", () => {
    const live: Record<string, boolean> = {};
    const reduce = createActivityFrameReducer((adds, removes) => {
      for (const id of adds) live[id] = true;
      for (const id of removes) delete live[id];
    });
    reduce.apply([A]);
    expect(live[A]).toBe(true);
    reduce.apply([]);
    expect(live[A]).toBeUndefined();
  });

  it("snapshots each frame so an in-place-mutated (reconcile-proxy) accessor can't strand a live id", () => {
    const live: Record<string, boolean> = {};
    const reduce = createActivityFrameReducer((adds, removes) => {
      for (const id of adds) live[id] = true;
      for (const id of removes) delete live[id];
    });
    // Simulate the wire's `reconcile` proxy: ONE array reused across ticks,
    // mutated in place from [A] to [] rather than replaced. If the reducer
    // retained this reference as `prev` instead of snapshotting it, the
    // live → empty diff would see `prev` already empty and never emit the
    // removal — the historical sticky-live bug.
    const frame: TerminalId[] = [A];
    reduce.apply(frame);
    expect(live[A]).toBe(true);
    frame.length = 0; // in-place live → empty reconcile
    reduce.apply(frame);
    expect(live[A]).toBeUndefined();
  });

  it("drain returns the still-live ids once, then is empty", () => {
    const reduce = createActivityFrameReducer(() => {});
    reduce.apply([A, B]);
    expect([...reduce.drain()].sort()).toEqual([A, B].sort());
    expect(reduce.drain()).toEqual([]);
  });
});
