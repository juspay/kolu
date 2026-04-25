import { describe, expect, it } from "vitest";
import { availableThemes, DEFAULT_THEME, DEFAULT_THEME_NAME } from "./theme";

// Build-time invariant: `themes.json` is regenerated from
// iTerm2-Color-Schemes by `just regenerate`. The cast in theme.ts
// types it as non-empty; this test backs the cast — if the regen
// pipeline ever produces empty output, CI fails before the cast
// can lie at runtime.
describe("themes.json invariant", () => {
  it("availableThemes is non-empty", () => {
    expect(availableThemes.length).toBeGreaterThan(0);
  });

  it("includes the default theme", () => {
    const found = availableThemes.find((t) => t.name === DEFAULT_THEME_NAME);
    expect(found?.theme).toBe(DEFAULT_THEME);
  });
});
