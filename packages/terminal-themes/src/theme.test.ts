import { describe, expect, it } from "vitest";
import { availableThemes, DEFAULT_THEME, DEFAULT_THEME_NAME } from "./theme";

describe("themes.json invariant", () => {
  it("availableThemes is non-empty", () => {
    expect(availableThemes.length).toBeGreaterThan(0);
  });

  it("includes the default theme", () => {
    const found = availableThemes.find((t) => t.name === DEFAULT_THEME_NAME);
    expect(found?.theme).toBe(DEFAULT_THEME);
  });
});
