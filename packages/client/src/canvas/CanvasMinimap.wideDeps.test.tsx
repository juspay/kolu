// @vitest-environment happy-dom
/** THE MINIMAP'S BOUNDING BOX AT FLEET SIZE — 250 tiles on one board.
 *
 *  `bounds` walked every tile's layout on ONE memo: the layout lookup plus
 *  four corner leaves per tile, so a board of a few hundred tiles put well
 *  over 200 sources on it and Solid's development build judged it
 *  `WIDE_SCOPE_DEPS`. A canvas has no cap on tiles.
 *
 *  What is pinned is the box itself: every tile's rectangle is placed from
 *  the padded bounding box of all of them, and the test computes that box
 *  from the fixture rather than from the product's fold. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createStore, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

/** A tile's box as this fixture holds it: the four numbers a layout carries,
 *  in a shape a leaf write can move (a wire layout is readonly). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const mirror = vi.hoisted(() => ({
  layout: ((_id: string) => undefined) as (
    id: string,
  ) => TileLayout | undefined,
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: (id: string) => ({
      repoColor: "#123456",
      key: { group: id, label: id, suffix: "" },
    }),
    getMetadata: () => ({ lastActivityAt: 0, state: "active" }),
  }),
}));
vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ isActiveTile: () => false }),
}));
vi.mock("./useTileTheme", () => ({ useTileTheme: () => () => "moonlit" }));
vi.mock("../terminal/staleness", () => ({
  useStaleCheck: () => () => false,
  formatTimeAgo: () => "",
}));
vi.mock("./viewport/useCanvasViewport", () => ({
  useCanvasViewport: () => ({
    zoom: () => 1,
    panX: () => 0,
    panY: () => 0,
    viewportSize: () => ({ width: 1200, height: 800 }),
    centerOnTile: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    resetZoom: () => {},
  }),
}));

import CanvasMinimap from "./CanvasMinimap";
import { usePendingLayouts } from "./usePendingLayouts";

const TILES = 250;
const ids = Array.from({ length: TILES }, (_, n) => `tile-${n}`);

/** The minimap's own geometry, restated here so the expected rectangles are
 *  computed independently of the component's fold. */
const MAP_W = 180;
const MAP_H = 120;
const MAP_PAD = 100;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the minimap must draw `one`, from the padded bounding box of every
 *  tile the fixture holds. */
function expectedRect(boxes: ReadonlyArray<TileLayout>, one: TileLayout): Rect {
  const minX = Math.min(...boxes.map((b) => b.x)) - MAP_PAD;
  const minY = Math.min(...boxes.map((b) => b.y)) - MAP_PAD;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + MAP_PAD;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + MAP_PAD;
  const scale = Math.min(MAP_W / (maxX - minX), MAP_H / (maxY - minY));
  return {
    left: (one.x - minX) * scale,
    top: (one.y - minY) * scale,
    width: one.w * scale,
    height: one.h * scale,
  };
}

/** The style the browser kept, as numbers — a rendered length is rounded, so
 *  the comparison is to three decimals rather than string-exact. */
const sameRect = (drawn: Rect | null, wanted: Rect): void => {
  expect(drawn).not.toBeNull();
  const rect = drawn as Rect;
  expect(rect.left).toBeCloseTo(wanted.left, 3);
  expect(rect.top).toBeCloseTo(wanted.top, 3);
  expect(rect.width).toBeCloseTo(wanted.width, 3);
  expect(rect.height).toBeCloseTo(wanted.height, 3);
};

let dispose: (() => void) | undefined;
beforeEach(() => usePendingLayouts().clear());
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("draws 250 tiles from one bounding box, with no wide memo", () => {
  const [state, setState] = createStore<{
    layouts: Record<string, Box>;
  }>({
    layouts: Object.fromEntries(
      ids.map((id, n) => [id, { x: n * 37, y: (n % 17) * 53, w: 300, h: 200 }]),
    ),
  });
  mirror.layout = (id) => state.layouts[id];
  takeSolidDiagnostics();

  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <CanvasMinimap
        shown={true}
        tileIds={ids}
        getLayout={(id) =>
          usePendingLayouts().resolveLayout(id as TerminalId, mirror.layout(id))
        }
        onSelect={() => {}}
        onStartTileDrag={() => null}
      />
    ),
    host,
  );
  flush();

  const rectOf = (id: string): Rect | null => {
    const el = host.querySelector<HTMLElement>(
      `[data-testid="minimap-tile-rect"][data-tile-id="${id}"]`,
    );
    return el === null
      ? null
      : {
          left: Number.parseFloat(el.style.left),
          top: Number.parseFloat(el.style.top),
          width: Number.parseFloat(el.style.width),
          height: Number.parseFloat(el.style.height),
        };
  };
  const boxes = (): TileLayout[] =>
    ids.map((id) => state.layouts[id] as TileLayout);

  expect(
    host.querySelectorAll('[data-testid="minimap-tile-rect"]'),
  ).toHaveLength(TILES);
  for (const id of ["tile-0", "tile-123", "tile-249"])
    sameRect(
      rectOf(id),
      expectedRect(boxes(), state.layouts[id] as TileLayout),
    );
  expect(diagnostics()).toEqual([]);

  // One tile moves far out: the box grows, so every rectangle is re-placed.
  setState((s) => {
    const row = s.layouts["tile-123"];
    if (row !== undefined) row.x = 20_000;
  });
  flush();
  for (const id of ["tile-0", "tile-123", "tile-249"])
    sameRect(
      rectOf(id),
      expectedRect(boxes(), state.layouts[id] as TileLayout),
    );
  expect(diagnostics()).toEqual([]);
});
