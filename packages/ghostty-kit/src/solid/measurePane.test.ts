import { describe, expect, it } from "vitest";
import { measurePane } from "./measurePane.ts";

const cell = { w: 8, h: 16 };

describe("measurePane", () => {
  it("refuses an empty or sliver box", () => {
    expect(measurePane({ width: 0, height: 100 }, cell)).toBeNull();
    expect(measurePane({ width: 100, height: 0 }, cell)).toBeNull();
    // 2×1 is the fit-addon floor, not a measurement.
    expect(measurePane({ width: 16, height: 16 }, cell)).toBeNull();
    expect(measurePane({ width: 24, height: 16 }, cell)).toBeNull();
  });

  it("returns the cell grid of a real pane", () => {
    expect(measurePane({ width: 800, height: 320 }, cell)).toEqual({
      cols: 100,
      rows: 20,
    });
  });
});
