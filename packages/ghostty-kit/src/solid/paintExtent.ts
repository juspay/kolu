import type { Engine, ScreenExtent } from "../engine.ts";
import type { StyledLine } from "../styled.ts";

/** Extent the paint path asks the engine for. Unlocked live bottom is a
 *  viewport; a scrolled window is a tail covering the offset. The engine
 *  formats only that selection in wasm — not the full scrollback. */
export function paintExtent(viewOffset: number, rows: number): ScreenExtent {
  if (viewOffset <= 0) return { kind: "viewport" };
  return { kind: "tail", lines: rows + viewOffset };
}

export function paintStyledLines(
  engine: Engine,
  viewOffset: number,
  rows: number,
): StyledLine[] {
  return engine.styledLines(paintExtent(viewOffset, rows));
}
