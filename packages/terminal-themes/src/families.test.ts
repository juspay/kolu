import { describe, expect, it } from "vitest";
import { FAMILY_PAIRS, resolveThemeForVariant } from "./families.ts";
import { availableThemes } from "./theme.ts";

describe("families", () => {
  const names = new Set(availableThemes.map((t) => t.name));

  it("every family-pair name exists in availableThemes", () => {
    const missing: string[] = [];
    for (const p of FAMILY_PAIRS) {
      if (!names.has(p.light)) missing.push(p.light);
      if (!names.has(p.dark)) missing.push(p.dark);
    }
    expect(missing).toEqual([]);
  });

  it("resolveThemeForVariant returns the wanted sibling", () => {
    expect(resolveThemeForVariant("Catppuccin Latte", "dark")).toBe(
      "Catppuccin Mocha",
    );
    expect(resolveThemeForVariant("Catppuccin Mocha", "light")).toBe(
      "Catppuccin Latte",
    );
  });

  it("resolveThemeForVariant is a no-op when already in the right variant", () => {
    expect(resolveThemeForVariant("Catppuccin Latte", "light")).toBe(
      "Catppuccin Latte",
    );
    expect(resolveThemeForVariant("Catppuccin Mocha", "dark")).toBe(
      "Catppuccin Mocha",
    );
  });

  it("resolveThemeForVariant returns the input unchanged for unknown themes", () => {
    expect(resolveThemeForVariant("Dracula", "light")).toBe("Dracula");
    expect(resolveThemeForVariant("Dracula", "dark")).toBe("Dracula");
    expect(resolveThemeForVariant("not-a-real-theme", "light")).toBe(
      "not-a-real-theme",
    );
  });
});
