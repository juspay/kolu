/** A colour as the VT stream expressed it. */
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
  /** SGR 2. Rendered as a fill mixed toward the background. */
  readonly dim: boolean;
  /** SGR 4. Drawn as a rule under the cell rather than a font feature, so both
   *  backends get the same line in the same place. */
  readonly underline: boolean;
  /** ANSI reverse-video, as the ATTRIBUTE: the swap is a rendering act, so a
   *  consumer that wants the raw fact still has it. */
  readonly inverse: boolean;
}

/** One row of the grid — only the cells worth painting. Blank, unstyled cells
 *  are omitted rather than carried as empty entries. */
export interface SnapshotRow {
  readonly cells: readonly SnapshotCell[];
}

/** A rectangular slice of a terminal's screen, ready to render.
 *
 *  There is deliberately NO `rows` field: row count is `lines.length`. */
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

function isBlank(cell: SnapshotCell): boolean {
  return (
    cell.chars.trim() === "" &&
    cell.bg.kind === "default" &&
    !cell.inverse &&
    !cell.underline
  );
}

const isTrailingHalf = (width: number): boolean => width === 0;

const fitsWithinSlice = (x: number, width: number, cols: number): boolean =>
  x + width <= cols;

/** Read a row of an xterm buffer into the wire-ready row shape.
 *
 *  `startLine`/`rowCount` bound the read; a line the buffer doesn't have
 *  yields an empty row rather than a hole, so `lines.length` always equals
 *  the requested `rows` and a consumer can index by screen row without
 *  re-deriving the offset.
 *
 *  `cols` is a real SLICE width, not just the buffer's own width: kaval reads
 *  a wide terminal at fewer columns to hold an attributed read inside its area
 *  cap. Leftmost columns, so a caller narrows the read by asking for a smaller
 *  `cols` and nothing else. */
export function readGrid(
  buffer: ReadableBuffer,
  cols: number,
  startLine: number,
  rowCount: number,
): SnapshotGrid {
  const lines: SnapshotRow[] = [];
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
      if (isTrailingHalf(width)) continue;
      if (!fitsWithinSlice(x, width, cols)) continue;
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
