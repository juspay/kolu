import { describe, expect, it } from "vitest";
import {
  fitFontSize,
  paneGrid,
  peekNatural,
  peekPans,
  peekWindowSize,
} from "./peekSize";

describe("peekNatural", () => {
  it("is the grid at the cell size plus the terminal's padding", () => {
    expect(
      peekNatural(
        { cols: 110, rows: 34 },
        { width: 8.4, height: 17 },
        { x: 26, y: 12 },
      ),
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
    // Half a point below the exact fit: a cell rounds up, so the exact one
    // still leaves a few pixels of screen past the view.
    expect(
      fitFontSize({
        cols: 212,
        cellWidth: 8.4,
        fontSize: 14,
        availWidth: 1374,
        padX: 26,
      }),
    ).toBe(10);
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

describe("peekWindowSize", () => {
  it("caps the window at the peek's own maximum, inside the browser window", () => {
    expect(peekWindowSize({ width: 1440, height: 900 })).toEqual({
      width: 1280,
      height: 836,
    });
    expect(peekWindowSize({ width: 2000, height: 1200 })).toEqual({
      width: 1280,
      height: 864,
    });
    expect(peekWindowSize({ width: 1000, height: 700 })).toEqual({
      width: 936,
      height: 636,
    });
  });
});

describe("paneGrid", () => {
  // A 14-point cell of 8.4×17 px inside 26 px of padding across, 12 down.
  const measured = {
    cell: { width: 8.4, height: 17 },
    pad: { x: 26, y: 12 },
    fontSize: 14,
    fit: true,
  };

  it("asks for every column and row the body holds", () => {
    // (1374 − 26) / 8.4 = 160.5 columns; (900 − 12) / 17 = 52.2 rows.
    expect(paneGrid({ ...measured, width: 1374, height: 900 })).toEqual({
      cols: 160,
      rows: 52,
    });
  });

  it("asks for no fewer than 80 columns, keeping the rows it holds", () => {
    // 474 / 8.4 = 56 columns of room.
    expect(
      paneGrid({ ...measured, fit: false, width: 500, height: 900 }),
    ).toEqual({ cols: 80, rows: 52 });
  });

  it("asks for no fewer than 24 rows, keeping the columns it holds", () => {
    // 288 / 17 = 16 rows of room.
    expect(paneGrid({ ...measured, width: 1374, height: 300 })).toEqual({
      cols: 160,
      rows: 24,
    });
  });

  it("counts the rows at the font Fit width shrinks 80 columns to", () => {
    // 80 columns in 500 px shrink 14 points to 9: a 10.9 px row, so 408 px
    // hold 37 rows where the 14-point font held 24.
    const body = { width: 500, height: 420 };
    expect(paneGrid({ ...measured, ...body })).toEqual({ cols: 80, rows: 37 });
    expect(paneGrid({ ...measured, ...body, fit: false })).toEqual({
      cols: 80,
      rows: 24,
    });
  });

  it("asks for nothing until the pane has measured", () => {
    const body = { width: 1374, height: 900 };
    expect(paneGrid({ ...measured, ...body, cell: null })).toBeNull();
    expect(paneGrid({ ...measured, ...body, pad: null })).toBeNull();
    expect(paneGrid({ ...measured, width: 0, height: 900 })).toBeNull();
  });
});
