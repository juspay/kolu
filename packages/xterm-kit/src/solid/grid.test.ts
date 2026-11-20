import { describe, expect, it } from "vitest";
import { type GridBox, gridForBox, sameGrid } from "./grid";

describe("sameGrid", () => {
  it("holds for two grids describing the same layout", () => {
    expect(sameGrid({ cols: 98, rows: 8 }, { cols: 98, rows: 8 })).toBe(true);
  });

  it("fails when the pane got WIDER", () => {
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
    expect(sameGrid({ cols: 100, rows: 30 }, { cols: 100, rows: 8 })).toBe(
      false,
    );
  });
});

const CHAR_WIDTH = 8.6154;
const CHAR_HEIGHT = 17.6;

function box(overrides: Partial<GridBox> = {}): GridBox {
  const devicePixelRatio = overrides.devicePixelRatio ?? 1;
  return {
    parentWidth: 1200,
    parentHeight: 900,
    paddingHorizontal: 0,
    paddingVertical: 0,
    scrollbarWidth: 14,
    charWidth: CHAR_WIDTH,
    letterSpacing: 0,
    deviceCellHeight: Math.ceil(CHAR_HEIGHT * devicePixelRatio),
    devicePixelRatio,
    ...overrides,
  };
}

function webglCellWidthCss(b: GridBox): number {
  return (
    (Math.floor(b.charWidth * b.devicePixelRatio) +
      Math.round(b.letterSpacing)) /
    b.devicePixelRatio
  );
}

describe("gridForBox", () => {
  it.each([
    { dpr: 1, webglUsedToSay: 148 },
    { dpr: 1.25, webglUsedToSay: 148 },
    { dpr: 1.5, webglUsedToSay: 148 },
    { dpr: 2, webglUsedToSay: 139 },
    { dpr: 2.25, webglUsedToSay: 140 },
    { dpr: 3, webglUsedToSay: 142 },
  ])("answers 137 columns for a 1200px box at pixel ratio $dpr (WebGL used to say $webglUsedToSay)", ({
    dpr,
  }) => {
    expect(gridForBox(box({ devicePixelRatio: dpr }))?.cols).toBe(137);
  });

  it("gives one pane one grid — nothing it reads says which renderer is painting", () => {
    const b = box({ devicePixelRatio: 2.25, parentWidth: 1054 });
    const available = b.parentWidth - b.scrollbarWidth;
    const oldFitUnderWebgl = Math.floor(available / webglCellWidthCss(b));
    const oldFitUnderDom = Math.floor(available / b.charWidth);
    expect([oldFitUnderWebgl, oldFitUnderDom]).toEqual([123, 120]);
    expect(gridForBox(b)?.cols).toBe(120);
  });

  it("fits inside the WebGL renderer's narrower cell too", () => {
    for (const dpr of [1, 1.25, 2, 2.25, 3]) {
      const b = box({ devicePixelRatio: dpr });
      const grid = gridForBox(b);
      expect(grid).not.toBeNull();
      const available = b.parentWidth - b.scrollbarWidth;
      expect(grid!.cols * webglCellWidthCss(b)).toBeLessThanOrEqual(available);
      expect(grid!.cols * CHAR_WIDTH).toBeLessThanOrEqual(available);
    }
  });

  it("adds letterSpacing in device pixels, rounded, the way both renderers do", () => {
    const b = box({ devicePixelRatio: 2, letterSpacing: 1.6 });
    expect(gridForBox(b)?.cols).toBe(
      Math.floor((1200 - 14) / (CHAR_WIDTH + 2 / 2)),
    );
  });

  it("keeps rows off the DOM renderer's rounded canvas height", () => {
    const b = box({ devicePixelRatio: 1.25, parentHeight: 900 });
    expect(gridForBox(b)?.rows).toBe(Math.floor(900 / (22 / 1.25)));
  });

  it("subtracts the element's padding and the viewport's scrollbar", () => {
    const b = box({ paddingHorizontal: 16, paddingVertical: 8 });
    expect(gridForBox(b)?.cols).toBe(Math.floor((1200 - 16 - 14) / CHAR_WIDTH));
    expect(gridForBox(b)?.rows).toBe(Math.floor((900 - 8) / 18));
  });

  it("hands back nothing when there is no box (a hidden pane)", () => {
    expect(gridForBox(box({ parentWidth: 0, parentHeight: 0 }))).toBeNull();
    expect(gridForBox(box({ parentHeight: 0 }))).toBeNull();
  });

  it("hands back nothing for a detached element's unparsable computed style", () => {
    expect(gridForBox(box({ parentWidth: Number.NaN }))).toBeNull();
  });

  it("hands back nothing before the font has been measured", () => {
    expect(gridForBox(box({ charWidth: 0 }))).toBeNull();
    expect(gridForBox(box({ deviceCellHeight: 0 }))).toBeNull();
  });

  it("refuses a degenerate box rather than clamping it (a split dragged shut)", () => {
    expect(gridForBox(box({ parentWidth: 14 + CHAR_WIDTH * 2.5 }))).toBeNull();
    expect(gridForBox(box({ parentHeight: 18 }))).toBeNull();
    expect(gridForBox(box({ parentWidth: 14 + CHAR_WIDTH * 3 }))?.cols).toBe(3);
  });
});
