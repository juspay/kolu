import { describe, it, expect } from "vitest";
import { fuzzyScore } from "./scorer";

describe("fuzzyScore", () => {
  it("returns null for non-matching queries", () => {
    expect(fuzzyScore("xyz", "abc.ts")).toBeNull();
  });

  it("returns score 0 for empty query", () => {
    const result = fuzzyScore("", "src/foo.ts");
    expect(result).toEqual({ score: 0, matches: [] });
  });

  it("matches all characters in order", () => {
    const result = fuzzyScore("ft", "foo.ts");
    expect(result).not.toBeNull();
    expect(result!.matches).toHaveLength(2);
  });

  it("returns null when query is longer than target", () => {
    expect(fuzzyScore("abcdef", "abc")).toBeNull();
  });

  it("rewards word-start matches over mid-word", () => {
    const wordStart = fuzzyScore("fb", "foo-bar.ts");
    const midWord = fuzzyScore("fb", "afob.ts");
    expect(wordStart).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(wordStart!.score).toBeGreaterThan(midWord!.score);
  });

  it("rewards consecutive matches", () => {
    const consecutive = fuzzyScore("foo", "foo.ts");
    const scattered = fuzzyScore("foo", "fxoxo.ts");
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(scattered!.score);
  });

  it("matches are case-insensitive", () => {
    const result = fuzzyScore("FOO", "foo.ts");
    expect(result).not.toBeNull();
  });

  it("shorter paths score higher for same match quality", () => {
    const short = fuzzyScore("f", "f.ts");
    const long = fuzzyScore("f", "very/deep/nested/f.ts");
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(short!.score).toBeGreaterThan(long!.score);
  });
});
