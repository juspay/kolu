/** Singleton canvas-drag signal — shared between TerminalCanvas (writer) and
 *  CanvasTile (reader). Module-scope so neither side creates per-mount
 *  inline closures that would share a V8 Context chain with component
 *  locals. Earlier per-tile `createDrag` closures pinned the component
 *  scope past disposal via their `$$pointerdown` handler on the title bar,
 *  one of the residual leaks after the Corvu/solid-dnd replacements.
 *
 *  At most one tile is being dragged at a time; a flat `{ id, dx, dy }` |
 *  null is sufficient. */

import { createSignal } from "solid-js";

export interface CanvasDragState {
  tileId: string;
  dx: number;
  dy: number;
}

const [state, setState] = createSignal<CanvasDragState | null>(null);

export const canvasDragState = state;
export const setCanvasDragState = setState;

/** Returns the current drag offset for a given tile (zero if not dragging). */
export function dragOffsetFor(tileId: string): { x: number; y: number } {
  const s = state();
  if (!s || s.tileId !== tileId) return { x: 0, y: 0 };
  return { x: s.dx, y: s.dy };
}
