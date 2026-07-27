/** The walk law: a jump that CYCLES, so repeat clicks reach every target
 *  instead of bouncing on the first — a thing you would otherwise only
 *  discover from behaviour. */

import { describe, expect, it } from "vitest";
import { nextAfter } from "./nextAfter";

describe("nextAfter", () => {
  it("walks past the one you are already on, so repeat clicks reach them all", () => {
    expect(nextAfter(["a", "b", "c"], "a")).toBe("b");
    expect(nextAfter(["a", "b", "c"], "b")).toBe("c");
  });

  it("wraps at the end", () => {
    expect(nextAfter(["a", "b"], "b")).toBe("a");
  });

  it("starts at the beginning when nothing is active, or the active one is elsewhere", () => {
    expect(nextAfter(["a", "b"], null)).toBe("a");
    expect(nextAfter(["a", "b"], "z")).toBe("a");
  });

  it("has nowhere to go in an empty set", () => {
    expect(nextAfter([], null)).toBeUndefined();
  });
});
