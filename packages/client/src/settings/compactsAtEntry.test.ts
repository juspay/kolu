import { describe, expect, it } from "vitest";
import { compactsAtEntry } from "./compactsAtEntry";

describe("compactsAtEntry — the custom field, in thousands of tokens", () => {
  it("reads a whole number of thousands, the bounds included", () => {
    expect(compactsAtEntry("250")).toBe(250_000);
    expect(compactsAtEntry("100")).toBe(100_000);
    expect(compactsAtEntry("1000")).toBe(1_000_000);
    expect(compactsAtEntry(" 300 ")).toBe(300_000);
  });

  it("refuses empty, out of range, a fraction and letters", () => {
    for (const typed of ["", "99", "1001", "250.5", "abc", "250k", "-200"])
      expect(compactsAtEntry(typed)).toBeNull();
  });
});
