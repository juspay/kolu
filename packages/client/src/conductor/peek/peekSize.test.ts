import { describe, expect, it } from "vitest";
import { fitFontSize, peekNatural, peekPans } from "./peekSize";

describe("peekNatural", () => {
  it("is the grid at the cell size plus the terminal's padding", () => {
    expect(
      peekNatural({ cols: 110, rows: 34 }, { width: 8.4, height: 17 }, { x: 26, y: 12 }),
    ).toEqual({ width: 950, height: 590 });
  });
});

describe("peekPans", () => {
  it("answers whether the terminal is wider than the room", () => {
    expect(peekPans(950, 1374)).toBe(false);
    expect(peekPans(1807, 1374)).toBe(true);
  });
});

describe("fitFontSize", () => {
  it("leaves a terminal that already fits alone", () => {
    expect(
      fitFontSize({
        cols: 110,
        cellWidth: 8.4,
        fontSize: 14,
        availWidth: 1374,
        padX: 26,
      }),
    ).toBe(14);
  });

  it("shrinks a wide terminal to the largest half point that fits", () => {
    expect(
      fitFontSize({
        cols: 212,
        cellWidth: 8.4,
        fontSize: 14,
        availWidth: 1374,
        padX: 26,
      }),
    ).toBe(10.5);
  });

  it("stops at the minimum font size on a phone", () => {
    expect(
      fitFontSize({
        cols: 212,
        cellWidth: 8.4,
        fontSize: 14,
        availWidth: 400,
        padX: 26,
      }),
    ).toBe(6);
  });
});
