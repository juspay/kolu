import type { TileLayout } from "./TileLayout";

export type ResizeDirection = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export interface ResizeHandle {
  /** Tailwind cursor class (e.g. `cursor-ns-resize`). */
  cursor: string;
  /** Tailwind absolute-position classes placing the hit area. */
  position: string;
}

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

export function applyResize(
  origin: TileLayout,
  direction: ResizeDirection,
  dxCanvas: number,
  dyCanvas: number,
  { minW, minH }: ResizeLimits,
  snap: (n: number) => number = (n) => n,
): TileLayout {
  const { horiz, vert } = DIRECTION_AXES[direction];

  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;

  if (horiz === "e") {
    const rightEdge = snap(origin.x + origin.w + dxCanvas);
    w = Math.max(minW, rightEdge - origin.x);
  } else if (horiz === "w") {
    const leftEdge = snap(origin.x + dxCanvas);
    w = Math.max(minW, origin.x + origin.w - leftEdge);
    x = origin.x + origin.w - w;
  }

  if (vert === "s") {
    const bottomEdge = snap(origin.y + origin.h + dyCanvas);
    h = Math.max(minH, bottomEdge - origin.y);
  } else if (vert === "n") {
    const topEdge = snap(origin.y + dyCanvas);
    h = Math.max(minH, origin.y + origin.h - topEdge);
    y = origin.y + origin.h - h;
  }

  return { x, y, w, h };
}
