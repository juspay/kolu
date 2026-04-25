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

  // Duplicate names would silently overwrite in the themeToPair Map and
  // produce a wrong sibling resolution at runtime — pin it as a CI failure.
  it("FAMILY_PAIRS has no duplicate theme names", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const p of FAMILY_PAIRS) {
      for (const name of [p.light, p.dark]) {
        if (seen.has(name)) dups.push(name);
        seen.add(name);
      }
    }
    expect(dups).toEqual([]);
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
