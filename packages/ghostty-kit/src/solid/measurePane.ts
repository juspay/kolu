/** Measure a pane's cell grid from its layout box.
 *
 *  A sliver (mid-collapse, first expanded frame, fit-addon floor) is not a
 *  measurement — publishing one would attach at 2×1, wrap every line, and
 *  leave buffer readers unable to rejoin the text. */

import type { TerminalGrid } from "./grid.ts";

/** `@xterm/addon-fit`'s clamp floor. A proposal AT this floor is the clamp,
 *  not the box. */
export const PANE_MIN_COLS = 2;
export const PANE_MIN_ROWS = 1;

export function measurePane(
  box: { width: number; height: number },
  cell: { w: number; h: number },
): TerminalGrid | null {
  if (cell.w <= 0 || cell.h <= 0) return null;
  if (box.width <= 0 || box.height <= 0) return null;
  if (box.width < cell.w * 2 || box.height < cell.h) return null;
  const cols = Math.floor(box.width / cell.w);
  const rows = Math.floor(box.height / cell.h);
  if (cols <= PANE_MIN_COLS || rows <= PANE_MIN_ROWS) return null;
  return { cols, rows };
}
