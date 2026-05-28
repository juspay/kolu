/** CSS generation for the canvas coordinate system.
 *  Pure functions mapping (canvas-space inputs, viewport state) → CSS strings.
 *  Encapsulates the transform formulas so the rendering strategy can change
 *  (e.g., SVG transforms, rotated canvas) without touching state or gestures.
 *  Per-tile transform composition (since #988 retired the wrapper transform)
 *  lives here too — keeps the canvas-to-screen mapping in one place so a
 *  future pan/zoom ordering change touches one file, not N. */

import { GRID_SIZE } from "./transforms";

/** CSS transform for the canvas viewport (scale + translate). Today this is
 *  surfaced as the `data-viewport` attribute on `canvas-container` for test
 *  observability of pan/zoom-only state — tiles themselves apply
 *  `tileTransformCSS` so the per-tile string also folds in layout + drag. */
export function canvasTransformCSS(
  panX: number,
  panY: number,
  zoom: number,
): string {
  return `scale(${zoom}) translate(${-panX}px, ${-panY}px)`;
}

/** CSS transform for a single tile rendered as a child of `canvas-container`
 *  (no shared wrapper transform). Pairs with `left: l.x; top: l.y` on the
 *  tile element and `transform-origin: 0 0` to anchor `scale` at the tile's
 *  natural top-left.
 *
 *  Math: a canvas-space point `(l.x, l.y)` maps to screen-space
 *  `((l.x - panX) * zoom, (l.y - panY) * zoom)`. With `transform-origin: 0 0`,
 *  `scale(z)` keeps the element's top-left anchored at its natural `(left, top)`,
 *  so we add `translate(l.x*(z-1) - panX*z + dragX, …)` to shift the
 *  post-scale top-left to the target screen position. Drag delta is added in
 *  screen-space directly (no `/zoom` divisor — `solid-dnd` reports
 *  `draggable.transform` in screen-space pixels). */
export function tileTransformCSS(
  layoutX: number,
  layoutY: number,
  panX: number,
  panY: number,
  zoom: number,
  dragX: number,
  dragY: number,
): string {
  const tx = layoutX * (zoom - 1) - panX * zoom + dragX;
  const ty = layoutY * (zoom - 1) - panY * zoom + dragY;
  return `translate(${tx}px, ${ty}px) scale(${zoom})`;
}

/** CSS background-position for the grid, tracking pan+zoom. */
export function gridBgPositionCSS(
  panX: number,
  panY: number,
  zoom: number,
): string {
  return `${-panX * zoom}px ${-panY * zoom}px`;
}

/** CSS background-size for the grid, tracking zoom. */
export function gridBgSizeCSS(zoom: number): string {
  const s = GRID_SIZE * zoom;
  return `${s}px ${s}px`;
}
