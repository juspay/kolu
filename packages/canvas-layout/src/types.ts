/** Axis-aligned rectangle in canvas-space pixels. Top-left origin.
 *  The framework's neutral layout type — Kolu's `TileLayout` is a
 *  structural alias of the same shape. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
