/**
 * "RESET TERMINAL SIZE" IS MINTED AGAINST THE LAYOUT THE TILE IS SHOWING.
 *
 * Reset is a gesture like drag-end, resize and the minimap drag: it seeds a
 * pending override so the tile snaps to the default size at once, and the
 * server's echo releases it. The override is judged against the layout it was
 * minted from, so for a brand-new tile — one whose only layout is the default
 * the canvas DERIVED and is still reporting — the base must be that default.
 * Minted against the tile's SAVED value instead (`undefined`, since the write
 * is still in flight) the default's own echo reads as a foreign layout, the
 * override is released, and the reset snaps straight back to the default size.
 *
 * `usePendingLayouts` is real here: it is the fact under test. The canvas
 * publishes its derived defaults into it, which is how a gesture raised
 * outside the canvas component reaches `layoutOf`.
 */

import type { TerminalId } from "kolu-common/surface";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

const tile = vi.hoisted(() => ({
  layout: undefined as TileLayout | undefined,
  written: [] as TileLayout[],
}));

vi.mock("../capabilities", () => ({ supportsSpatialCanvas: () => true }));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ getDisplayInfo: () => undefined }),
}));
vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({
    activeId: () => TILE,
    getLayout: () => tile.layout,
    setLayout: (_id: string, layout: TileLayout) => tile.written.push(layout),
    activateVisiblePane: () => {},
    tileIds: () => [TILE],
  }),
}));
vi.mock("./viewport/useCanvasViewport", () => ({
  useCanvasViewport: () => ({
    viewportCenter: () => ({ x: 2000, y: 1500 }),
    centerOnTile: () => {},
  }),
}));

import { useCanvasArrange } from "./useCanvasArrange";
import { usePendingLayouts } from "./usePendingLayouts";

const TILE = "tile-1" as TerminalId;
/** The default the canvas derived for this brand-new tile and reported; its
 *  echo has not come back yet, so the tile's saved layout is still nothing. */
const DERIVED: TileLayout = { x: -600, y: -400, w: 420, h: 320 };

afterEach(() => {
  tile.layout = undefined;
  tile.written = [];
  usePendingLayouts().clear();
});

it("holds the reset when the tile's derived default echoes", () => {
  const pending = usePendingLayouts();
  // The canvas placed the tile and reported that default (the effect's apply
  // arm publishes it here).
  pending.publishDerivedDefault(TILE, DERIVED);

  useCanvasArrange().resetActiveTileSize();
  // The pending store's write lands on the flush, as it does in the app.
  flush();
  const reset = tile.written.at(-1) as TileLayout;
  expect(reset).toBeDefined();
  expect(reset).not.toEqual(DERIVED);
  expect(pending.resolveLayout(TILE, undefined)).toEqual(reset);

  // The DEFAULT's echo lands — this client's own earlier write catching up,
  // and the base the reset was minted against. The reset must stand.
  tile.layout = DERIVED;
  expect(pending.resolveLayout(TILE, DERIVED)).toEqual(reset);

  // The reset's own echo releases it.
  expect(pending.resolveLayout(TILE, reset)).toEqual(reset);
  expect(pending.hasOverride(TILE, reset)).toBe(false);
});
