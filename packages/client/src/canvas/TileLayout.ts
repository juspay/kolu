/** Canvas tile layout type — position and size in canvas-space pixels.
 *  Domain-agnostic alias of CanvasLayout so the canvas module doesn't
 *  leak the kolu-common type into its props API. */

import type { CanvasLayout } from "kolu-common/surface";

export type TileLayout = CanvasLayout;

/** Structural equality for two layouts. Used by callers that skip
 *  no-op writes (e.g. an arrange that finds a tile already at its
 *  target position) and by the canvas's pending-cleanup effect. */
export function layoutsEqual(a: TileLayout, b: TileLayout): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
