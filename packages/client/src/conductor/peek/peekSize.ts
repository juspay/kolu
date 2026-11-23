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
export const PEEK_MARGIN = 64;
export const PEEK_MAX_WIDTH = 1280;
export const PEEK_MAX_HEIGHT = 864;

/** The one window size the peek takes on a desktop, taken from the browser window. */
export function peekWindowSize(win: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.min(win.width - PEEK_MARGIN, PEEK_MAX_WIDTH),
    height: Math.min(win.height - PEEK_MARGIN, PEEK_MAX_HEIGHT),
  };
}

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

/** A cell's rendered width does not scale exactly with the font size (the
 *  renderer rounds), so a size computed from the base cell's width can still
 *  leave a few pixels of screen past the view — measured as 6px at 1440
 *  wide. The fit leaves both this much room and half a point of headroom
 *  below the exact fit, which is the smallest step the font has. */
export const FIT_SLACK_PX = 8;

/** The largest half-point font size at which every column fits, or the font size itself. */
export function fitFontSize(i: {
  cols: number;
  cellWidth: number;
  fontSize: number;
  availWidth: number;
  padX: number;
}): number {
  const need = i.cols * i.cellWidth;
  const room = i.availWidth - i.padX - FIT_SLACK_PX;
  if (need <= room) return i.fontSize;
  const exact = (i.fontSize * room) / need;
  return Math.max(PEEK_MIN_FONT_SIZE, Math.floor(exact * 2) / 2 - 0.5);
}
