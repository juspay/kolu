import { describe, expect, it } from "vitest";
import { displayRecencyAt } from "./RecencyCell";

describe("displayRecencyAt", () => {
  it("keeps a blocked parent's wait duration on its own agent transition", () => {
    expect(displayRecencyAt("wait-chip", 2_000, 10)).toBe(10);
  });

  it("uses aggregate tile activity for the ordinary age and window", () => {
    expect(displayRecencyAt("ago", 2_000, 10)).toBe(2_000);
    expect(displayRecencyAt("hidden", 2_000, 10)).toBe(2_000);
  });
});
