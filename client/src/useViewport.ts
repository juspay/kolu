/** Viewport grid — the cols×rows that every main terminal in the primary
 *  pane shares. They all render into the same container, so they all have
 *  the same grid; this module is the one place that holds that value.
 *
 *  One signal, one writer (the currently-visible main terminal's FitAddon),
 *  many readers (every hidden main-terminal instance, every sidebar preview).
 *  Sub-terminals live in their own resizable pane and don't participate —
 *  they measure themselves. */

import { createSignal } from "solid-js";

export interface ViewportDimensions {
  cols: number;
  rows: number;
}

const [dimensions, setDimensions] = createSignal<
  ViewportDimensions | undefined
>(undefined, {
  equals: (a, b) =>
    a === b || (!!a && !!b && a.cols === b.cols && a.rows === b.rows),
});

/** Current viewport grid, or `undefined` until the first fit publishes. */
export const viewportDimensions = dimensions;

/** Publish new viewport dimensions. Called by the visible main terminal
 *  after FitAddon measures its container. */
export function setViewportDimensions(cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0) return;
  setDimensions({ cols, rows });
}
