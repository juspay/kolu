import { describe, expect, it } from "vitest";
import { ALIAS, LANGS } from "./highlight";

describe("highlight — alias/grammar consistency", () => {
  it("maps every alias to a language in LANGS", () => {
    const langs = new Set<string>(LANGS);
    for (const [alias, target] of Object.entries(ALIAS)) {
      expect(langs.has(target), `alias "${alias}" → "${target}"`).toBe(true);
    }
  });
});
