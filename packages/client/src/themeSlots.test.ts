import { describe, it, expect } from "vitest";
import { effectiveThemeNameForMode, seedThemeSlots } from "./themeSlots";

describe("effectiveThemeNameForMode", () => {
  it("prefers the requested slot", () => {
    expect(
      effectiveThemeNameForMode(
        { light: "3024 Day", dark: "Dracula" },
        "light",
      ),
    ).toBe("3024 Day");
    expect(
      effectiveThemeNameForMode({ light: "3024 Day", dark: "Dracula" }, "dark"),
    ).toBe("Dracula");
  });

  it("falls back to the other slot when the requested slot is unset", () => {
    expect(effectiveThemeNameForMode({ dark: "Dracula" }, "light")).toBe(
      "Dracula",
    );
    expect(effectiveThemeNameForMode({ light: "3024 Day" }, "dark")).toBe(
      "3024 Day",
    );
  });
});

describe("seedThemeSlots", () => {
  it("preserves explicit partial slots during restore", () => {
    expect(seedThemeSlots({ dark: "Dracula" }, "3024 Day")).toEqual({
      dark: "Dracula",
    });
  });

  it("seeds both slots for brand new terminals when only a fallback theme exists", () => {
    expect(seedThemeSlots(undefined, "Tomorrow Night")).toEqual({
      light: "Tomorrow Night",
      dark: "Tomorrow Night",
    });
  });

  it("returns undefined when neither slots nor fallback exist", () => {
    expect(seedThemeSlots(undefined, undefined)).toBeUndefined();
  });
});
