/** Dragging a tile's edge or corner — the gesture, separated from the canvas
 *  that renders the handles, as `minimapGestures.ts` is from the minimap.
 *  The geometry it applies is `resizeGeometry.ts`'s; what it does with the
 *  result is the caller's, through `TileResizePorts`.
 *
 *  WHAT THE GESTURE KNOWS ITSELF: whether it moved. The pending layout it
 *  writes on every pointermove is reactive state, and a Solid 2 write is
 *  staged until the flush — a move and a release delivered in ONE synchronous
 *  run (what a synthesized gesture does) would leave the release reading a
 *  store that still says "nothing pending" and dropping the resize. A pending
 *  entry an EARLIER gesture left still commits, exactly as it did before. */

import {
  applyResize,
  type ResizeDirection,
  type ResizeLimits,
} from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import { capturePointerGesture } from "./viewport/capturePointerGesture";

export interface TileResizePorts {
  /** The floor a tile may be dragged to. */
  readonly limits: ResizeLimits;
  /** The tile's layout as it stands — pending override included. */
  layoutOf: (id: string) => TileLayout | undefined;
  /** Screen-space delta → canvas-space (divide by zoom). */
  normalizeDelta: (dx: number, dy: number) => { dx: number; dy: number };
  snapToGrid: (value: number) => number;
  /** Does a pending layout already stand for this tile — one an earlier
   *  gesture or an arrange wrote, which this release still commits? */
  hasPending: (id: string) => boolean;
  /** Hold the layout locally while the server's echo is out. */
  setPending: (id: string, layout: TileLayout) => void;
  /** Hold it AND report it — the release's write. */
  commit: (id: string, layout: TileLayout) => void;
}

/** Start a resize from a pointerdown on one of a tile's handles. Answers the
 *  gesture's `AbortController` — the caller keeps it and passes it back as
 *  `abortPrevious` so a second press cancels the first — or `null` when the
 *  tile has no layout to resize, in which case nothing was started and a
 *  gesture already in flight is left alone. */
export function startTileResize(
  e: PointerEvent,
  id: string,
  direction: ResizeDirection,
  abortPrevious: AbortController | null,
  ports: TileResizePorts,
): AbortController | null {
  e.preventDefault();
  e.stopPropagation();
  const origin = ports.layoutOf(id);
  if (!origin) return null;
  const startX = e.clientX;
  const startY = e.clientY;

  abortPrevious?.abort();
  const abort = new AbortController();
  let moved = false;
  capturePointerGesture(
    {
      onMove: (ev) => {
        moved = true;
        const { dx, dy } = ports.normalizeDelta(
          ev.clientX - startX,
          ev.clientY - startY,
        );
        ports.setPending(
          id,
          applyResize(origin, direction, dx, dy, ports.limits),
        );
      },
      onEnd: (ev) => {
        // No motion — skip commit so a bare click doesn't round-trip the server.
        if (!moved && !ports.hasPending(id)) return;
        const { dx, dy } = ports.normalizeDelta(
          ev.clientX - startX,
          ev.clientY - startY,
        );
        ports.commit(
          id,
          applyResize(
            origin,
            direction,
            dx,
            dy,
            ports.limits,
            ports.snapToGrid,
          ),
        );
      },
    },
    abort,
  );
  return abort;
}
