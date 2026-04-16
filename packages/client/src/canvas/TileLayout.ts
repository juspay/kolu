/** Canvas tile layout type — position and size in canvas-space pixels.
 *  Domain-agnostic alias of CanvasLayout so the canvas module doesn't
 *  leak the kolu-common type into its props API. */

import type { CanvasLayout } from "kolu-common";

export type TileLayout = CanvasLayout;
