import { describe, expect, it } from "vitest";
import { type GridBox, gridForBox, sameGrid } from "./grid";

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

/** kolu's own font at its default size: FiraCode Nerd Font 14px, as
 *  `CharSizeService` measures it in Chromium (`measureText('W').width`). */
const CHAR_WIDTH = 8.6154;
/** …and its `fontBoundingBoxAscent + fontBoundingBoxDescent`. */
const CHAR_HEIGHT = 17.6;

/** The box a grid is measured from, with kolu's font and options and no
 *  padding — `overrides` names the one fact under test. */
function box(overrides: Partial<GridBox> = {}): GridBox {
  const devicePixelRatio = overrides.devicePixelRatio ?? 1;
  return {
    parentWidth: 1200,
    parentHeight: 900,
    paddingHorizontal: 0,
    paddingVertical: 0,
    // xterm's default vertical scrollbar.
    scrollbarWidth: 14,
    charWidth: CHAR_WIDTH,
    letterSpacing: 0,
    // What BOTH renderers compute: ceil the char height into device pixels,
    // then apply lineHeight (1 here) and floor.
    deviceCellHeight: Math.ceil(CHAR_HEIGHT * devicePixelRatio),
    devicePixelRatio,
    ...overrides,
  };
}

/** What xterm's WebGL renderer would make of the same measurement: the char
 *  width floored to whole DEVICE pixels, so glyphs land on an integer grid
 *  (`WebglRenderer._updateDimensions`). This is the number the grid must NOT
 *  be computed from, and the one the result must still fit inside. */
function webglCellWidthCss(b: GridBox): number {
  return (
    (Math.floor(b.charWidth * b.devicePixelRatio) +
      Math.round(b.letterSpacing)) /
    b.devicePixelRatio
  );
}

describe("gridForBox", () => {
  // The measurement that motivated this function: xterm's two renderers derive
  // different cell widths from one character measurement, so a tile that
  // swapped renderers (the WebGL budget is 8 contexts, handed around by
  // recency) changed column count and SIGWINCHed its PTY. The right-hand column
  // is what `@xterm/addon-fit` answered for the same box while the WebGL
  // renderer was painting it.
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
    // The human's own browser, 14 Nov: pixel ratio 2.25, a 1054px tile. Every
    // terminal holding a WebGL context measured 123 columns and every DOM-only
    // one in the same box measured 120, because `@xterm/addon-fit` divided by
    // whichever renderer was attached. The grid now comes from facts the
    // renderers SHARE, so there is nothing left to disagree about: one box, one
    // answer, and it is the DOM-width one (the wider cell, see below).
    const b = box({ devicePixelRatio: 2.25, parentWidth: 1054 });
    const available = b.parentWidth - b.scrollbarWidth;
    const oldFitUnderWebgl = Math.floor(available / webglCellWidthCss(b));
    const oldFitUnderDom = Math.floor(available / b.charWidth);
    expect([oldFitUnderWebgl, oldFitUnderDom]).toEqual([123, 120]);
    expect(gridForBox(b)?.cols).toBe(120);
  });

  it("fits inside the WebGL renderer's narrower cell too", () => {
    // Columns are computed with the WIDER of the two cells (the DOM renderer's,
    // which does not floor), so the row still fits when the WebGL renderer
    // paints it — it just leaves a few unused pixels at the right edge.
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
    // 1.6 device px of letter spacing rounds to 2, which at dpr 2 is 1 CSS px
    // of cell — 8.6154 + 1 per column.
    const b = box({ devicePixelRatio: 2, letterSpacing: 1.6 });
    expect(gridForBox(b)?.cols).toBe(
      Math.floor((1200 - 14) / (CHAR_WIDTH + 2 / 2)),
    );
  });

  it("keeps rows off the DOM renderer's rounded canvas height", () => {
    // At pixel ratio 1.25 the DOM renderer re-derives its CSS cell height from
    // a rounded canvas height (17.5833 where the WebGL renderer has 17.6) —
    // 0.1%, but enough to move a row in a tall pane. Both agree on the DEVICE
    // cell height, which is what rows are computed from.
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
    // 2 columns / 1 row is `@xterm/addon-fit`'s own floor: an answer AT it
    // carries no information about the box, so it is refused in the same class
    // as no box at all — a fabricated grid would resize a live PTY to it.
    expect(gridForBox(box({ parentWidth: 14 + CHAR_WIDTH * 2.5 }))).toBeNull();
    expect(gridForBox(box({ parentHeight: 18 }))).toBeNull();
    // One column past the floor IS a measurement.
    expect(gridForBox(box({ parentWidth: 14 + CHAR_WIDTH * 3 }))?.cols).toBe(3);
  });
});
