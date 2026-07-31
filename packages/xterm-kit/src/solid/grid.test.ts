import { describe, expect, it } from "vitest";
import { sameGrid } from "./grid";

describe("sameGrid", () => {
  it("holds for two grids describing the same layout", () => {
    expect(sameGrid({ cols: 98, rows: 8 }, { cols: 98, rows: 8 })).toBe(true);
  });

  it("fails when the pane got WIDER", () => {
    // The width is what wraps: a snapshot laid out for 80 columns painted into a
    // 213-column pane is the original defect — every long line broken in half.
    expect(sameGrid({ cols: 80, rows: 24 }, { cols: 213, rows: 50 })).toBe(
      false,
    );
  });

  it("fails on a cols-only change", () => {
    expect(sameGrid({ cols: 100, rows: 30 }, { cols: 99, rows: 30 })).toBe(
      false,
    );
  });

  it("fails on a rows-only change", () => {
    // Height alone does not rewrap, but it does move the viewport — the split
    // stuck above its own live bottom was a rows change.
    expect(sameGrid({ cols: 100, rows: 30 }, { cols: 100, rows: 8 })).toBe(
      false,
    );
  });
});
