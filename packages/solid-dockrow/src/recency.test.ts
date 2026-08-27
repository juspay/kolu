import { describe, expect, it } from "vitest";
import { displayRecencyAt, recencyMode } from "./recency.ts";

describe("recencyMode", () => {
  it("a blocked row shows the wait chip even though its pip is active", () => {
    expect(recencyMode({ asking: true, active: true })).toBe("wait-chip");
  });

  it("an active row hides its age — it is 'just now' by definition", () => {
    expect(recencyMode({ asking: false, active: true })).toBe("hidden");
  });

  it("a quiet row shows its age", () => {
    expect(recencyMode({ asking: false, active: false })).toBe("ago");
  });
});

describe("displayRecencyAt", () => {
  it("keeps a blocked parent's wait duration on its own agent transition", () => {
    expect(displayRecencyAt("wait-chip", 2_000, 10)).toBe(10);
  });

  it("uses aggregate tile activity for the ordinary age and window", () => {
    expect(displayRecencyAt("ago", 2_000, 10)).toBe(2_000);
    expect(displayRecencyAt("hidden", 2_000, 10)).toBe(2_000);
  });
});
