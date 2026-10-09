/** What a terminal pane looks like on screen, for something painted over it
 *  (the tile tip): the grid's cell geometry, where the cursor sits, which cells
 *  are empty where the tip would go, whether the pane is in view, and the scale
 *  it is drawn at. The terminal owns its xterm,
 *  so it builds this and hands it out; nothing else reaches into xterm for it.
 *
 *  Geometry is in LAYOUT px within the pane (an overlay positioned inside the
 *  pane is transformed with it); `scale` turns a layout length into on-screen px
 *  (the canvas zoom, or 1 when maximized). */

import type { IBufferCell, IBufferLine, Terminal as XTerm } from "@xterm/xterm";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { useCanvasViewport } from "../canvas/viewport/useCanvasViewport";

/** The grid as drawn in the pane. */
export interface PaneGrid {
  readonly cols: number;
  readonly rows: number;
  /** One cell, layout px. */
  readonly cellW: number;
  readonly cellH: number;
  /** The grid's top-left corner within the pane, layout px. */
  readonly originX: number;
  readonly originY: number;
  /** The cursor's cell, or `null` while it is out of view (scrolled back). */
  readonly cursor: { readonly col: number; readonly row: number } | null;
  /** Empty cells right after the cursor, up to one short of the next text on
   *  its row (a right-side prompt) or to the edge; 0 when the cursor sits in
   *  text; `null` with no cursor in view. */
  readonly promptRun: number | null;
  /** Empty cells on the second row, leftward from one cell in from the right
   *  edge, up to one short of the text on that row. */
  readonly cornerRun: number;
}

/** The row's cell at `col` holds nothing visible (a wide character's second
 *  half is not empty). */
function blankAt(line: IBufferLine, col: number, cell: IBufferCell): boolean {
  const c = line.getCell(col, cell);
  if (c === undefined) return true;
  const chars = c.getChars();
  return c.getWidth() === 1 && (chars === "" || chars === " ");
}

/** Empty cells from `from` stepping by `step`, stopping one short of the first
 *  text (so the tip never touches it) or at the row's end. */
function blankRun(
  line: IBufferLine | undefined,
  from: number,
  step: 1 | -1,
  cols: number,
  cell: IBufferCell,
): number {
  if (line === undefined)
    return Math.max(0, step === 1 ? cols - from : from + 1);
  let n = 0;
  for (let col = from; col >= 0 && col < cols; col += step) {
    if (!blankAt(line, col, cell)) return Math.max(0, n - 1);
    n++;
  }
  return n;
}

export interface PaneView {
  /** `null` until the grid has a measured size. */
  readonly grid: Accessor<PaneGrid | null>;
  /** The pane intersects the screen (clipping ancestors counted). */
  readonly onScreen: Accessor<boolean>;
  /** On-screen px per layout px. */
  readonly scale: Accessor<number>;
}

function sameGrid(a: PaneGrid | null, b: PaneGrid | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.cellW === b.cellW &&
    a.cellH === b.cellH &&
    a.originX === b.originX &&
    a.originY === b.originY &&
    a.cursor?.col === b.cursor?.col &&
    a.cursor?.row === b.cursor?.row &&
    a.promptRun === b.promptRun &&
    a.cornerRun === b.cornerRun
  );
}

/** Track `term` drawn inside `pane`. Call from the terminal's `onReady` (it
 *  registers listeners and cleanups on the caller's owner). */
export function trackPaneView(pane: HTMLElement, term: XTerm): PaneView {
  const [grid, setGrid] = createSignal<PaneGrid | null>(null, {
    equals: sameGrid,
  });
  const [onScreen, setOnScreen] = createSignal(false);
  const [scale, setScale] = createSignal(1);

  const measure = () => {
    const paneRect = pane.getBoundingClientRect();
    const s = pane.offsetWidth > 0 ? paneRect.width / pane.offsetWidth : 1;
    setScale(s);
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    if (
      !screen ||
      screen.offsetWidth === 0 ||
      screen.offsetHeight === 0 ||
      s === 0
    ) {
      setGrid(null);
      return;
    }
    const screenRect = screen.getBoundingClientRect();
    const buf = term.buffer.active;
    const cols = term.cols;
    const cell = buf.getNullCell();
    // The cursor is in view only while the viewport sits at the bottom of the
    // buffer; scrolled back, its row is off the visible grid.
    const cursor =
      buf.viewportY === buf.baseY
        ? { col: buf.cursorX, row: buf.cursorY }
        : null;
    let promptRun: number | null = null;
    if (cursor !== null) {
      const line = buf.getLine(buf.viewportY + cursor.row);
      // The cursor sitting on text (moved back into what was typed) leaves no
      // room: the cells after it are that text.
      promptRun =
        line !== undefined && !blankAt(line, cursor.col, cell)
          ? 0
          : blankRun(line, cursor.col + 1, 1, cols, cell);
    }
    setGrid({
      cols,
      rows: term.rows,
      cellW: screen.offsetWidth / cols,
      cellH: screen.offsetHeight / term.rows,
      originX: (screenRect.left - paneRect.left) / s,
      originY: (screenRect.top - paneRect.top) / s,
      cursor,
      promptRun,
      cornerRun: blankRun(
        buf.getLine(buf.viewportY + 1),
        cols - 2,
        -1,
        cols,
        cell,
      ),
    });
  };

  // At most one measure per frame: a flood of output changes the screen far
  // more often than anything can paint.
  let frame = 0;
  const soon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };
  const disposables = [
    term.onWriteParsed(soon),
    term.onCursorMove(soon),
    term.onResize(soon),
    term.onScroll(soon),
  ];
  const resize = new ResizeObserver(soon);
  resize.observe(pane);
  const intersect = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) setOnScreen(last.isIntersecting);
    soon();
  });
  intersect.observe(pane);
  // A canvas zoom changes the scale without resizing or moving the pane in
  // layout, so neither observer fires: re-measure once the new transform is
  // painted.
  createEffect(on(useCanvasViewport().zoom, soon, { defer: true }));
  measure();

  onCleanup(() => {
    for (const d of disposables) d.dispose();
    resize.disconnect();
    intersect.disconnect();
    cancelAnimationFrame(frame);
  });
  return { grid, onScreen, scale };
}
