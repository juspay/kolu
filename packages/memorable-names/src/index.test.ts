import { describe, expect, it } from "vitest";
import wordsJson from "../words.json" with { type: "json" };
import { randomName } from "./index";

// Build-time invariant: the regen pipeline must never produce empty
// word lists. The cast in index.ts assumes non-empty; this is the
// runtime check that backs the type cast at the import boundary.
describe("words.json invariant", () => {
  it("adjectives is non-empty", () => {
    expect(wordsJson.adjectives.length).toBeGreaterThan(0);
  });
  it("nouns is non-empty", () => {
    expect(wordsJson.nouns.length).toBeGreaterThan(0);
  });
});

describe("randomName", () => {
  it("returns ADJ-NOUN format", () => {
    const name = randomName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("returns different names on subsequent calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => randomName()));
    expect(names.size).toBeGreaterThan(1);
  });
});
