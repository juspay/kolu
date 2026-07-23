import { describe, expect, it } from "vitest";
import { highlightSegments } from "./highlightMatch";

describe("highlightSegments", () => {
  it("returns the whole string unhit when query is empty", () => {
    expect(highlightSegments("watch-edge", "")).toEqual([
      { text: "watch-edge", hit: false },
    ]);
  });

  it("bolds a single token hit case-insensitively", () => {
    expect(highlightSegments("watch-edge", "EDGE")).toEqual([
      { text: "watch-", hit: false },
      { text: "edge", hit: true },
    ]);
  });

  it("bolds every AND-token hit", () => {
    expect(highlightSegments("kolu watch-edge", "kolu edge")).toEqual([
      { text: "kolu", hit: true },
      { text: " watch-", hit: false },
      { text: "edge", hit: true },
    ]);
  });

  it("merges adjacent hits from overlapping tokens", () => {
    // "ab" and "bc" overlap on 'b' → whole "abc" is one hit run
    expect(highlightSegments("abc", "ab bc")).toEqual([
      { text: "abc", hit: true },
    ]);
  });
});
