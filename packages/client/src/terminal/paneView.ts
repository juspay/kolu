/** What a terminal pane looks like on screen, for something painted over it
 *  (the tile tip): the grid's cell geometry, where the cursor sits, whether the
 *  pane is in view, and the scale it is drawn at. The terminal owns its xterm,
 *  so it builds this and hands it out; nothing else reaches into xterm for it.
 *
 *  Geometry is in LAYOUT px within the pane (an overlay positioned inside the
 *  pane is transformed with it); `scale` turns a layout length into on-screen px
 *  (the canvas zoom, or 1 when maximized). */

import type { Terminal as XTerm } from "@xterm/xterm";
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
    a.cursor?.row === b.cursor?.row
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
    setGrid({
      cols: term.cols,
      rows: term.rows,
      cellW: screen.offsetWidth / term.cols,
      cellH: screen.offsetHeight / term.rows,
      originX: (screenRect.left - paneRect.left) / s,
      originY: (screenRect.top - paneRect.top) / s,
      // The cursor is in view only while the viewport sits at the bottom of
      // the buffer; scrolled back, its row is off the visible grid.
      cursor:
        buf.viewportY === buf.baseY
          ? { col: buf.cursorX, row: buf.cursorY }
          : null,
    });
  };

  // At most one measure per frame: a flood of output moves the cursor far more
  // often than anything can paint.
  let frame = 0;
  const soon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };
  const disposables = [
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
