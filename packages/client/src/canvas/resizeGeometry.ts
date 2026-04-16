/** Resize geometry for canvas tiles — pure, data-driven.
 *
 *  `RESIZE_HANDLES` is the single source of truth: each of the 8 directions
 *  maps to a cursor class and absolute-position class string. Drives both the
 *  `<For>` over handles in `CanvasTile` and the delta-to-rect transform in
 *  `applyResize`. Adding or changing a direction is a one-entry edit.
 *
 *  `applyResize` is a pure function — no viewport/zoom knowledge, no pending
 *  state. Caller normalizes the pointer delta to canvas-space first. */

import type { TileLayout } from "./TileLayout";

export type ResizeDirection = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export interface ResizeHandle {
  /** Tailwind cursor class (e.g. `cursor-ns-resize`). */
  cursor: string;
  /** Tailwind absolute-position classes placing the hit area. */
  position: string;
}

/** Edges are inset from the corners so the corner squares own those hotspots.
 *  Corners are rendered later in DOM order than edges so overlap favors them. */
export const RESIZE_HANDLES: Record<ResizeDirection, ResizeHandle> = {
  n: { cursor: "cursor-ns-resize", position: "top-0 left-3 right-3 h-1.5" },
  s: { cursor: "cursor-ns-resize", position: "bottom-0 left-3 right-3 h-1.5" },
  e: { cursor: "cursor-ew-resize", position: "top-3 bottom-3 right-0 w-1.5" },
  w: { cursor: "cursor-ew-resize", position: "top-3 bottom-3 left-0 w-1.5" },
  nw: { cursor: "cursor-nwse-resize", position: "top-0 left-0 w-3 h-3" },
  ne: { cursor: "cursor-nesw-resize", position: "top-0 right-0 w-3 h-3" },
  sw: { cursor: "cursor-nesw-resize", position: "bottom-0 left-0 w-3 h-3" },
  se: { cursor: "cursor-nwse-resize", position: "bottom-0 right-0 w-3 h-3" },
};

export interface ResizeLimits {
  minW: number;
  minH: number;
}

/** Which edges each direction moves. Lifted out of `applyResize` so the fresh
 *  `Record<ResizeDirection, …>` literal fails to compile if the union ever
 *  gains or loses a variant without matching axis entries. */
interface DirectionAxes {
  horiz: "w" | "e" | null;
  vert: "n" | "s" | null;
}

const DIRECTION_AXES: Record<ResizeDirection, DirectionAxes> = {
  n: { horiz: null, vert: "n" },
  s: { horiz: null, vert: "s" },
  e: { horiz: "e", vert: null },
  w: { horiz: "w", vert: null },
  nw: { horiz: "w", vert: "n" },
  ne: { horiz: "e", vert: "n" },
  sw: { horiz: "w", vert: "s" },
  se: { horiz: "e", vert: "s" },
};

/** Compute a new tile rect from a pointer delta applied to a snapshot origin.
 *  `dx`/`dy` are already in canvas-space (caller normalizes by viewport zoom).
 *  West/north edges shift `x`/`y` so the opposite edge stays pinned.
 *
 *  `snap` (optional) is applied to the *moving edge*, not to width/height, so
 *  grid-snap on release keeps the pinned edge where the user left it. */
export function applyResize(
  origin: TileLayout,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  { minW, minH }: ResizeLimits,
  snap: (n: number) => number = (n) => n,
): TileLayout {
  const { horiz, vert } = DIRECTION_AXES[direction];

  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;

  if (horiz === "e") {
    const rightEdge = snap(origin.x + origin.w + dx);
    w = Math.max(minW, rightEdge - origin.x);
  } else if (horiz === "w") {
    const leftEdge = snap(origin.x + dx);
    w = Math.max(minW, origin.x + origin.w - leftEdge);
    x = origin.x + origin.w - w;
  }

  if (vert === "s") {
    const bottomEdge = snap(origin.y + origin.h + dy);
    h = Math.max(minH, bottomEdge - origin.y);
  } else if (vert === "n") {
    const topEdge = snap(origin.y + dy);
    h = Math.max(minH, origin.y + origin.h - topEdge);
    y = origin.y + origin.h - h;
  }

  return { x, y, w, h };
}
