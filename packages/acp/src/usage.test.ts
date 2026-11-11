/**
 * The usage report, over values.
 *
 * The payloads here are what the Claude Code adapter (captured at 0.66.0)
 * actually sends — captured off the wire across four turns and a `/model` —
 * plus the near misses, which are the whole reason this is a function rather
 * than a field access: a fraction with a broken half in it is worse on screen
 * than no fraction at all.
 */

import { describe, expect, test } from "vitest";

import { usageIn } from "./usage.ts";

describe("how full the context is", () => {
  test("the two numbers a report states", () => {
    // Verbatim off the wire: the mid-stream frame, which carries no cost.
    expect(
      usageIn({ sessionUpdate: "usage_update", used: 22102, size: 1000000 }),
    ).toEqual({ used: 22102, size: 1000000 });
  });

  test("the turn's last frame is read for the same two, and its cost dropped", () => {
    // The final frame adds a cumulative session cost and an origin `_meta`.
    // Neither is drawn, and neither may leak into the shape the panel holds:
    // what a session has SPENT is a different question from whether it is
    // about to run out of room.
    expect(
      usageIn({
        sessionUpdate: "usage_update",
        used: 22925,
        size: 200000,
        cost: { amount: 0.175023, currency: "USD" },
        _meta: { "_claude/origin": { kind: "human" } },
      }),
    ).toEqual({ used: 22925, size: 200000 });
  });

  test("a window that is not a window is nothing to draw", () => {
    // `0` and `NaN` are values the adapter has met from third-party backends —
    // it guards its own writes with `> 0` for this reason. `22k/0` on screen
    // would be inviting arithmetic on nonsense.
    expect(usageIn({ used: 22102, size: 0 })).toBeNull();
    expect(usageIn({ used: 22102, size: -1 })).toBeNull();
    expect(usageIn({ used: 22102, size: Number.NaN })).toBeNull();
    expect(usageIn({ used: 22102, size: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test("a spent-nothing conversation is a fact, and a negative one is not", () => {
    // Zero is the number every session opens on, so it must survive the guard
    // that a negative one does not.
    expect(usageIn({ used: 0, size: 200000 })).toEqual({
      used: 0,
      size: 200000,
    });
    expect(usageIn({ used: -1, size: 200000 })).toBeNull();
  });

  test("more used than fits is reported, not tidied away", () => {
    // The surprising case is the one a person most needs to see; clamping it
    // to a neat 100% would hide exactly that.
    expect(usageIn({ used: 240000, size: 200000 })).toEqual({
      used: 240000,
      size: 200000,
    });
  });

  test("a payload that does not say is not guessed at", () => {
    expect(usageIn({ used: 22102 })).toBeNull();
    expect(usageIn({ size: 200000 })).toBeNull();
    expect(usageIn({ used: "22102", size: "200000" })).toBeNull();
    expect(usageIn({ used: 22102.5, size: 200000 })).toBeNull();
    expect(usageIn({})).toBeNull();
    expect(usageIn(null)).toBeNull();
    expect(usageIn(undefined)).toBeNull();
  });
});
