/** A terminal grid, what makes two of them the same, and how a BOX becomes one.
 *
 *  **This module is where kolu's sizing rule is DECIDED**, and the one place
 *  that explains it; everything else on the path points here. The rule, in a
 *  sentence: a terminal's size must not depend on which renderer is painting
 *  it. xterm's WebGL renderer floors the character measurement to whole device
 *  pixels so glyphs land on an integer grid (`WebglRenderer._updateDimensions`)
 *  and its DOM renderer does not (`DomRenderer._updateDimensions`), so
 *  `@xterm/addon-fit` — which divides the box by the ACTIVE renderer's
 *  `css.cell.width` — answered two different column counts for one box, and a
 *  tile that changed renderer resized its PTY. {@link gridForBox} therefore
 *  takes {@link GridBox}: layout plus the font facts both renderers start
 *  from, and nothing either of them has already rounded.
 *
 *  Kept in its own JSX-free module beside `<Xterm>`: the component owns the
 *  grid's LIFETIME (measure, publish, compare), while the value, its equality
 *  and the arithmetic that produces it are plain facts both the kit and its
 *  consumers ask about — and facts that can be tested without a DOM.
 *  `./measureBox` reads a live terminal into the input this module consumes. */

/** A terminal grid — cols × rows. */
export interface TerminalGrid {
  cols: number;
  rows: number;
}

/** Do two grids describe the same layout? The kit compares its own `grid`
 *  signal with this, and a consumer holding bytes laid out FOR a grid (a
 *  serialized screen) asks it whether those bytes still describe the pane.
 *  Both are the same question, so they share one answer. */
export function sameGrid(a: TerminalGrid, b: TerminalGrid): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

/** Everything a grid is computed FROM: layout facts (the box, in CSS pixels)
 *  and font facts (how big one cell is). Not one of them depends on which
 *  renderer is painting — see this module's header for why that is the whole
 *  point. `measureGridBox` says where each value is read from. */
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

/** A grid this small is a clamp, not a measurement — see {@link gridForBox}.
 *  The numbers are `@xterm/addon-fit`'s own `MINIMUM_COLS` / `MINIMUM_ROWS`
 *  floor, kept verbatim so retiring that addon changed no refusal. */
const DEGENERATE_COLS = 2;
const DEGENERATE_ROWS = 1;

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
 *  below {@link DEGENERATE_COLS}×{@link DEGENERATE_ROWS}. */
export function gridForBox(box: GridBox): TerminalGrid | null {
  // One rule, not one clause per field: every number must be real. A detached
  // element's computed style parses to NaN, and a field added later is covered
  // without anyone remembering to extend a list.
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
  // A letterSpacing negative enough to cancel the glyph leaves no cell to
  // divide by — and a negative divisor would answer a positive column count.
  if (cellWidth <= 0) return null;

  const availableWidth =
    box.parentWidth - box.paddingHorizontal - box.scrollbarWidth;
  const availableHeight = box.parentHeight - box.paddingVertical;
  const cols = Math.floor(availableWidth / cellWidth);
  const rows = Math.floor(availableHeight / cellHeight);
  if (cols <= DEGENERATE_COLS || rows <= DEGENERATE_ROWS) return null;
  return { cols, rows };
}
