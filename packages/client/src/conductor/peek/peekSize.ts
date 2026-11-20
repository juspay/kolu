import type { TerminalGrid } from "@kolu/xterm-kit/solid";

/** One cell of the terminal, in CSS px, as the renderer measured it. */
export interface PeekCell {
  readonly width: number;
  readonly height: number;
}

/** The terminal's own padding around its cells, in CSS px. */
export interface PeekPad {
  readonly x: number;
  readonly y: number;
}

export const PEEK_MIN_FONT_SIZE = 6;

/** The window size a terminal wants: its grid at its own cell size, plus its padding. */
export function peekNatural(
  grid: TerminalGrid,
  cell: PeekCell,
  pad: PeekPad,
): { width: number; height: number } {
  return {
    width: Math.ceil(grid.cols * cell.width + pad.x),
    height: Math.ceil(grid.rows * cell.height + pad.y),
  };
}

/** Does a terminal of this width need to be panned in the room it has? */
export function peekPans(naturalWidth: number, availWidth: number): boolean {
  return naturalWidth > availWidth;
}

/** The largest half-point font size at which every column fits, or the font size itself. */
export function fitFontSize(i: {
  cols: number;
  cellWidth: number;
  fontSize: number;
  availWidth: number;
  padX: number;
}): number {
  const need = i.cols * i.cellWidth;
  const room = i.availWidth - i.padX;
  if (need <= room) return i.fontSize;
  return Math.max(
    PEEK_MIN_FONT_SIZE,
    Math.floor(((i.fontSize * room) / need) * 2) / 2,
  );
}
