/** CSS generation for the canvas coordinate system.
 *  Pure functions: takes (panX, panY, zoom) numbers, returns CSS strings.
 *  Encapsulates the transform formula so the rendering strategy can change
 *  (e.g., SVG transforms, rotated canvas) without touching state or gestures. */

import { GRID_SIZE } from "./transforms";

/** CSS transform for the inner canvas div (scale + translate). */
export function canvasTransformCSS(
  panX: number,
  panY: number,
  zoom: number,
): string {
  return `scale(${zoom}) translate(${-panX}px, ${-panY}px)`;
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
