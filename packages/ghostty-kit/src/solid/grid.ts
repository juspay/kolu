/** A terminal grid — cols × rows. */

export interface TerminalGrid {
  cols: number;
  rows: number;
}

export function sameGrid(a: TerminalGrid, b: TerminalGrid): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}
