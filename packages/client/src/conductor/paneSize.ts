/**
 * A work's live pane, on a desktop, sets its terminal's size.
 *
 * The person is looking at the terminal through this pane, so the pane is the
 * one thing that knows how big the terminal should be: the most columns and
 * rows its body holds, never below the size a terminal is born at
 * ({@link paneGrid}, below). Everything else follows — Look, a phone's or a
 * tablet's pane, a tile behind the Conductor (`terminal/shownPane.ts`) — and
 * draws the terminal at whatever size the stream states.
 *
 * It speaks on TWO occasions only, and that is the whole policy:
 *
 *  - when the pane comes on screen measured (connected, on the desktop layout,
 *    with a grid to ask for);
 *  - when the grid it would ask for changes — the window resized, the rail
 *    dragged, a second terminal halving the stack.
 *
 * Never for any other reason: not a re-attach of its screen, not someone
 * else's resize, not the scroll lock. It does not re-assert, so two viewers
 * cannot trade the size back and forth: the last pane to come on screen or to
 * change shape wins, and a terminal someone else resized stays so until this
 * pane has a reason of its own to speak. Its screen still attaches asking for
 * nothing (`peek/peekAttach.ts`) and draws whatever size the stream states.
 *
 * What it says goes through the tile's own publisher (`terminal/publishGrid.ts`):
 * the 250 ms settle, so a drag costs one resize, and the host-not-connected
 * latch. A pane that leaves the screen drops what is still settling.
 */

import { BIRTH_GRID } from "@kolu/xterm-kit";
import {
  gridForBox,
  sameGrid,
  type TerminalGrid,
} from "@kolu/xterm-kit/solid";
import { fitFontSize, type PeekCell, type PeekPad } from "./peek/peekSize";

export interface PaneSizeDeps {
  /** The pane holds a read of its terminal's screen — it is on screen. */
  readonly connected: () => boolean;
  /** The desktop layout. A phone's or a tablet's pane follows. */
  readonly desktop: () => boolean;
  /** The grid the pane would ask for ({@link paneGrid}), `null` until it has
   *  measured. */
  readonly asked: () => TerminalGrid | null;
  /** State a grid to the terminal (`publishGrid.ts` owns when it lands). */
  readonly publish: (grid: TerminalGrid) => void;
  /** Drop a publish that has not landed yet. */
  readonly cancelPublish: () => void;
  /** Restate a grid a not-connected window dropped, if one is still owed
   *  (`publishGrid.ts`'s latch, which also checks the host). The same publish
   *  landing late, not a new reason to speak — restated only while the pane
   *  is on screen, as the tile restates behind its own gate (`shownPane.ts`). */
  readonly restateOwed: () => void;
}

export interface PaneSize {
  /** Re-read the facts and speak on a CHANGE. Idempotent: safe on every tick
   *  of any of them, and of the host's state. */
  observe(): void;
}

export function createPaneSize(deps: PaneSizeDeps): PaneSize {
  /** The grid last stated while on screen, or `null` while off it — so
   *  coming back on screen speaks once, and an unchanged grid never does. */
  let stated: TerminalGrid | null = null;
  return {
    observe() {
      if (deps.connected()) deps.restateOwed();
      const grid = deps.connected() && deps.desktop() ? deps.asked() : null;
      if (!grid) {
        if (stated) deps.cancelPublish();
        stated = null;
        return;
      }
      if (stated && sameGrid(stated, grid)) return;
      stated = grid;
      deps.publish(grid);
    },
  };
}

/** THE GRID A PANE WOULD ASK FOR — the most columns and rows its body holds,
 *  never below the size a terminal is born at ({@link BIRTH_GRID}), each axis
 *  floored on its own. `null` while the pane has not measured its cell or
 *  padding, or its body is too small to hold a grid at all.
 *
 *  `cell` is the cell measured at `fontSize`, the font the pane draws at when
 *  nothing shrinks it — never the cell of a font Fit width already shrank,
 *  which this would shrink again. With Fit width on and room for fewer
 *  columns than the floor, the floor's columns are drawn at the font Fit
 *  width shrinks to, so the rows are counted at that font: a smaller font
 *  holds more of them.
 *
 *  That font is not drawn yet, so its row is an ESTIMATE — the measured row
 *  scaled by the font ratio, then rounded UP to a whole pixel. The renderer's
 *  row is the font's height rounded up to a whole device pixel (xterm's
 *  `DomRenderer`: `Math.ceil(charSize.height * dpr)`), so the real row is at
 *  least that tall: rounding up can ask for a row too few, never one too
 *  many, at any pixel ratio — the worst it costs is a strip thinner than a
 *  row, where rounding down would cut the top row off.
 *
 *  The box-to-grid division is the kit's (`gridForBox`), fed the pane's own
 *  measurements: the cell as drawn, so device pixels are already folded in. */
export function paneGrid(i: {
  width: number;
  height: number;
  cell: PeekCell | null;
  pad: PeekPad | null;
  fontSize: number;
  fit: boolean;
}): TerminalGrid | null {
  const { cell, pad } = i;
  if (!cell || !pad) return null;
  const holds = (c: PeekCell): TerminalGrid | null =>
    gridForBox({
      parentWidth: i.width,
      parentHeight: i.height,
      paddingHorizontal: pad.x,
      paddingVertical: pad.y,
      scrollbarWidth: 0,
      charWidth: c.width,
      letterSpacing: 0,
      deviceCellHeight: c.height,
      devicePixelRatio: 1,
    });
  const full = holds(cell);
  if (!full) return null;
  if (!i.fit || full.cols >= BIRTH_GRID.cols)
    return {
      cols: Math.max(BIRTH_GRID.cols, full.cols),
      rows: Math.max(BIRTH_GRID.rows, full.rows),
    };
  const scale =
    fitFontSize({
      cols: BIRTH_GRID.cols,
      cellWidth: cell.width,
      fontSize: i.fontSize,
      availWidth: i.width,
      padX: pad.x,
    }) / i.fontSize;
  const small = holds({
    width: cell.width * scale,
    height: Math.ceil(cell.height * scale),
  });
  if (!small) return null;
  return {
    cols: BIRTH_GRID.cols,
    rows: Math.max(BIRTH_GRID.rows, small.rows),
  };
}
