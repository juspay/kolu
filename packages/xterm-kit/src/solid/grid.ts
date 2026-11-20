export interface TerminalGrid {
  cols: number;
  rows: number;
}

export function sameGrid(a: TerminalGrid, b: TerminalGrid): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

export interface GridBox {
  /** The mount element's parent's computed layout width, CSS px. */
  parentWidth: number;
  /** The mount element's parent's computed layout height, CSS px. */
  parentHeight: number;
  /** The xterm element's own left+right padding, CSS px. */
  paddingHorizontal: number;
  /** The xterm element's own top+bottom padding, CSS px. */
  paddingVertical: number;
  /** What the viewport's vertical scrollbar reserves, CSS px. */
  scrollbarWidth: number;
  /** xterm's own character-width measurement, UNROUNDED, in CSS px
   *  (`CharSizeService.width` — one 'W' through `measureText`). */
  charWidth: number;
  /** The `letterSpacing` option, in DEVICE px — the unit xterm states it in
   *  and rounds it in. */
  letterSpacing: number;
  /** `dimensions.device.cell.height` — the integer BOTH renderers compute,
   *  identically, from the same ceil/floor chain. Taking the height from here
   *  rather than from the active renderer's `css.cell.height` is what keeps
   *  rows renderer-independent: the DOM renderer re-derives its CSS height
   *  from a ROUNDED canvas height, which drifts ~0.1% at fractional pixel
   *  ratios (17.5833 vs 17.6 at 1.25) — enough to move a row. */
  deviceCellHeight: number;
  /** The device pixel ratio those device-pixel values were measured against. */
  devicePixelRatio: number;
}

const MEASURABLE_MIN_COLS = 2;
const MEASURABLE_MIN_ROWS = 1;

/** The grid `box` can hold — or `null` when the box cannot be MEASURED.
 *
 *  Columns are the available width divided by the cell width the DOM renderer
 *  uses; rows are the available height divided by the one cell height both
 *  renderers agree on. Both divisions floor: a partial cell is not a cell.
 *
 *  Two ways a box answers nothing, and both return `null` rather than a
 *  number, because a fabricated grid is exactly what `<Xterm>`'s `grid()`
 *  promises never to contain — and publishing one SIGWINCHes a live PTY to it:
 *
 *  ① Nothing to measure: a missing or zero box, or a terminal whose font has
 *  not been measured yet (`charWidth` 0 before the first render, which is also
 *  what xterm's own renderers bail on). A detached element's computed style
 *  parses to `NaN`, so non-finite input is refused in the same breath.
 *
 *  ② A present-but-degenerate box (a split dragged nearly closed, a panel
 *  mid-collapse, a tile mid-layout-transition) whose honest answer is at or
 *  below {@link MEASURABLE_MIN_COLS}×{@link MEASURABLE_MIN_ROWS}. */
export function gridForBox(box: GridBox): TerminalGrid | null {
  for (const value of Object.values(box)) {
    if (!Number.isFinite(value)) return null;
  }
  if (box.parentWidth <= 0 || box.parentHeight <= 0) return null;
  if (box.charWidth <= 0 || box.deviceCellHeight <= 0) return null;
  if (box.devicePixelRatio <= 0) return null;

  // Both renderers add letterSpacing to the DEVICE char width, rounded; in CSS
  // pixels that is `round(letterSpacing) / dpr`. Added here exactly as they add
  // it, so the cell this divides by IS the DOM renderer's cell.
  const cellWidth =
    box.charWidth + Math.round(box.letterSpacing) / box.devicePixelRatio;
  const cellHeight = box.deviceCellHeight / box.devicePixelRatio;
  if (cellWidth <= 0) return null;

  const availableWidth =
    box.parentWidth - box.paddingHorizontal - box.scrollbarWidth;
  const availableHeight = box.parentHeight - box.paddingVertical;
  const cols = Math.floor(availableWidth / cellWidth);
  const rows = Math.floor(availableHeight / cellHeight);
  if (cols <= MEASURABLE_MIN_COLS || rows <= MEASURABLE_MIN_ROWS) return null;
  return { cols, rows };
}
