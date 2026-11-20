import { describe, expect, test } from "vitest";

import { usageIn } from "./usage.ts";

describe("how full the context is", () => {
  test("the two numbers a report states", () => {
    expect(
      usageIn({ sessionUpdate: "usage_update", used: 22102, size: 1000000 }),
    ).toEqual({ used: 22102, size: 1000000 });
  });

  test("the turn's last frame is read for the same two, and its cost dropped", () => {
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
    expect(usageIn({ used: 22102, size: 0 })).toBeNull();
    expect(usageIn({ used: 22102, size: -1 })).toBeNull();
    expect(usageIn({ used: 22102, size: Number.NaN })).toBeNull();
    expect(usageIn({ used: 22102, size: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test("a spent-nothing conversation is a fact, and a negative one is not", () => {
    expect(usageIn({ used: 0, size: 200000 })).toEqual({
      used: 0,
      size: 200000,
    });
    expect(usageIn({ used: -1, size: 200000 })).toBeNull();
  });

  test("more used than fits is reported, not tidied away", () => {
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
