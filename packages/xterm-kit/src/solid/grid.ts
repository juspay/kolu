/** A terminal grid and the one statement of what makes two of them the same.
 *
 *  Kept in its own JSX-free module beside `<Xterm>`: the component owns the
 *  grid's LIFETIME (measure, publish, compare), while the value and its equality
 *  are a plain fact both the kit and its consumers ask about — and a fact that
 *  can be tested without the component's DOM. */

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
