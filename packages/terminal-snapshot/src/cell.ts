/** What a terminal cell IS, independent of how it will be painted.
 *
 *  This is the fact the PTY host owns and the renderer consumes: the
 *  characters a VT stream put on the grid, plus the attributes it asked for —
 *  and NOT the pixels those attributes resolve to. The split is deliberate and
 *  load-bearing: a colour here is what the escape sequence *said*
 *  (`palette 4`, `rgb 0x00ff88`, or "whatever default means"), never a CSS
 *  string, because "what default means" is a THEME question and the mirror
 *  that produced these cells has no theme. Resolution happens once, in
 *  {@link ../scene.ts}, against the theme the caller chose.
 *
 *  Structural, not nominal, and deliberately so — `@xterm/headless`'s
 *  `IBufferCell` (the daemon's mirror) and `@xterm/xterm`'s (the browser's)
 *  both satisfy {@link ReadableCell} without either package being imported
 *  here. That is what lets ONE renderer serve a headless daemon and a live
 *  browser tab. */

/** A colour as the VT stream expressed it.
 *
 *  A closed union rather than a nullable index + a nullable rgb: "palette 4"
 *  and "rgb #000004" are different facts that happen to share a number, and
 *  an illegal combination (both, neither) is unrepresentable here. */
export type CellColor =
  | { readonly kind: "default" }
  | { readonly kind: "palette"; readonly index: number }
  | { readonly kind: "rgb"; readonly value: number };

export const DEFAULT_COLOR: CellColor = { kind: "default" };

/** One painted cell of the grid.
 *
 *  `width` is the VT display width: 1 for an ordinary cell, 2 for the leading
 *  half of a wide (CJK / emoji) glyph, and 0 for the trailing half — which is
 *  already covered by its leader and must NOT be painted again. Callers skip
 *  `width === 0` rather than the renderer silently double-painting. */
export interface SnapshotCell {
  /** Zero-based column of this cell's LEFT edge. */
  readonly col: number;
  /** The cell's characters (a base char plus any combining marks). */
  readonly chars: string;
  readonly width: number;
  readonly fg: CellColor;
  readonly bg: CellColor;
  readonly bold: boolean;
  readonly italic: boolean;
  /** SGR 2. Rendered as a fill mixed toward the background, which is how a
   *  terminal shows it — and it matters: an agent TUI uses dim as its
   *  secondary voice (Claude Code's tool-result lines), so painting it at full
   *  intensity is the picture disagreeing with the screen. */
  readonly dim: boolean;
  /** SGR 4. Drawn as a rule under the cell rather than a font feature, so both
   *  backends get the same line in the same place. */
  readonly underline: boolean;
  /** ANSI reverse-video. Kept as the ATTRIBUTE, not pre-swapped colours: the
   *  swap is a rendering act, and doing it here would mean a consumer that
   *  wants the raw fact (a text export, a diff) can't get it back. */
  readonly inverse: boolean;
}

/** One row of the grid — only the cells worth painting.
 *
 *  Blank, unstyled cells are omitted rather than carried as empty entries: a
 *  terminal screen is mostly blank, so a row is typically a handful of cells,
 *  and this is what keeps the grid cheap enough to put on a wire. */
export interface SnapshotRow {
  readonly cells: readonly SnapshotCell[];
}

/** A rectangular slice of a terminal's screen, ready to render.
 *
 *  There is deliberately NO `rows` field. It would be a second authority for
 *  a number `lines.length` already holds, and a consumer would then have to
 *  pick one — which is exactly the bug shape that hides in a flat product of
 *  fields: a grid claiming 200 rows while carrying 3 reads perfectly well
 *  field-by-field, and sizes an image 200 rows tall with 3 rows of content in
 *  it. Row count is asked of the lines. */
export interface SnapshotGrid {
  readonly cols: number;
  readonly lines: readonly SnapshotRow[];
}

/** The subset of xterm.js's `IBufferCell` this package reads.
 *
 *  Predicate methods (`isFgRGB`) rather than the raw `getFgColorMode()`
 *  comparisons because the mode enum is not part of xterm's public API and
 *  differs between 16- and 256-colour cells. */
export interface ReadableCell {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isFgRGB(): boolean;
  isBgRGB(): boolean;
  isFgPalette(): boolean;
  isBgPalette(): boolean;
  isBold(): number;
  isItalic(): number;
  isInverse(): number;
  isDim(): number;
  isUnderline(): number;
}

/** The subset of xterm.js's `IBuffer` this package reads. */
export interface ReadableBuffer {
  readonly length: number;
  getLine(y: number):
    | {
        getCell(x: number, dst?: ReadableCell): ReadableCell | undefined;
      }
    | undefined;
  getNullCell(): ReadableCell;
}

function colorOf(isRgb: boolean, isPalette: boolean, value: number): CellColor {
  if (isRgb) return { kind: "rgb", value };
  if (isPalette) return { kind: "palette", index: value };
  return DEFAULT_COLOR;
}

/** True when a cell would paint nothing at all — blank text on default
 *  background with no attribute that could still show (inverse paints the
 *  foreground colour as a block, so an inverse blank is NOT skippable). */
function isBlank(cell: SnapshotCell): boolean {
  return (
    cell.chars.trim() === "" &&
    cell.bg.kind === "default" &&
    !cell.inverse &&
    // An underline shows on a blank cell; dim without ink does not.
    !cell.underline
  );
}

/** Read a row of an xterm buffer into the wire-ready row shape.
 *
 *  `startLine`/`rowCount` bound the read; a line the buffer doesn't have
 *  yields an empty row rather than a hole, so `lines.length` always equals
 *  the requested `rows` and a consumer can index by screen row without
 *  re-deriving the offset. */
export function readGrid(
  buffer: ReadableBuffer,
  cols: number,
  startLine: number,
  rowCount: number,
): SnapshotGrid {
  const lines: SnapshotRow[] = [];
  // ONE scratch cell reused across the whole read — xterm's `getCell(x, dst)`
  // fills the destination in place, which is the documented way to walk a
  // buffer without allocating a cell object per column.
  const scratch = buffer.getNullCell();
  for (let y = 0; y < rowCount; y++) {
    const line = buffer.getLine(startLine + y);
    if (!line) {
      lines.push({ cells: [] });
      continue;
    }
    const cells: SnapshotCell[] = [];
    for (let x = 0; x < cols; x++) {
      const raw = line.getCell(x, scratch);
      if (!raw) continue;
      const width = raw.getWidth();
      // The trailing half of a wide glyph — its leader already covers this
      // column. Painting it again would double-strike the glyph.
      if (width === 0) continue;
      const cell: SnapshotCell = {
        col: x,
        chars: raw.getChars(),
        width,
        fg: colorOf(raw.isFgRGB(), raw.isFgPalette(), raw.getFgColor()),
        bg: colorOf(raw.isBgRGB(), raw.isBgPalette(), raw.getBgColor()),
        bold: raw.isBold() !== 0,
        italic: raw.isItalic() !== 0,
        dim: raw.isDim() !== 0,
        underline: raw.isUnderline() !== 0,
        inverse: raw.isInverse() !== 0,
      };
      if (!isBlank(cell)) cells.push(cell);
    }
    lines.push({ cells });
  }
  return { cols, lines };
}
