import type { CanvasLayout } from "@kolu/padi-client/surface";

export type TileLayout = CanvasLayout;

export function layoutsEqual(a: TileLayout, b: TileLayout): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
