// @vitest-environment happy-dom
/**
 * Dragging a tile's edge: the release commits the size the move reached, and
 * a bare click on a handle commits nothing. The pending layout the move
 * writes is a real Solid store here, because what this gesture must not do is
 * ask that store whether it moved — a Solid 2 write is staged until the
 * flush, so a move and a release in ONE synchronous run (what a synthesized
 * gesture does) would read it back as "never moved".
 */

import { createRoot, createStore, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { startTileResize, type TileResizePorts } from "./resizeGesture";
import type { TileLayout } from "./TileLayout";

const TILE = "tile-1";
const ORIGIN: TileLayout = { x: 100, y: 100, w: 400, h: 300 };

let disposeRoot: (() => void) | undefined;
afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
});

/** The canvas's answers, over a store that stages its writes as the real
 *  pending-layout store does. */
function ports() {
  let pending: Record<string, TileLayout> = {};
  let setPending: (id: string, layout: TileLayout) => void = () => {};
  createRoot((dispose) => {
    disposeRoot = dispose;
    const [store, write] = createStore<Record<string, TileLayout>>({});
    pending = store;
    setPending = (id, layout) =>
      write((all) => {
        all[id] = layout;
      });
  });
  const committed: TileLayout[] = [];
  const canvas: TileResizePorts = {
    limits: { minW: 300, minH: 200 },
    layoutOf: (id) => (id === TILE ? (pending[id] ?? ORIGIN) : undefined),
    normalizeDelta: (dx, dy) => ({ dx, dy }),
    snapToGrid: (value) => Math.round(value / 10) * 10,
    hasPending: (id) => pending[id] !== undefined,
    setPending,
    commit: (id, layout) => {
      setPending(id, layout);
      committed.push(layout);
    },
  };
  return { canvas, committed };
}

const pointer = (type: string, clientX: number, clientY: number) =>
  new PointerEvent(type, { clientX, clientY, bubbles: true });

it("commits the size a move and its release reach in one frame", () => {
  const { canvas, committed } = ports();
  startTileResize(pointer("pointerdown", 500, 400), TILE, "se", null, canvas);
  // No flush between these two: one synchronous run, so the move's store
  // write is still staged when the release asks what happened.
  window.dispatchEvent(pointer("pointermove", 560, 400));
  window.dispatchEvent(pointer("pointerup", 560, 400));
  flush();
  expect(committed).toEqual([{ x: 100, y: 100, w: 460, h: 300 }]);
});

it("commits nothing for a bare click on a handle", () => {
  const { canvas, committed } = ports();
  startTileResize(pointer("pointerdown", 500, 400), TILE, "se", null, canvas);
  window.dispatchEvent(pointer("pointerup", 500, 400));
  flush();
  expect(committed).toEqual([]);
});
