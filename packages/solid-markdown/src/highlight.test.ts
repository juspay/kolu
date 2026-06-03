import { describe, expect, it } from "vitest";
import { ALIAS, LANGS } from "./highlight";

describe("highlight — alias/grammar consistency", () => {
  // Every alias must point at a grammar we actually load. A drift (an alias
  // target missing from LANGS) would otherwise fail silently at runtime —
  // codeToHtml throws, gets caught, and the block downgrades to plain — so we
  // assert it loudly here instead.
  it("maps every alias to a language in LANGS", () => {
    const langs = new Set<string>(LANGS);
    for (const [alias, target] of Object.entries(ALIAS)) {
      expect(langs.has(target), `alias "${alias}" → "${target}"`).toBe(true);
    }
  });
});
