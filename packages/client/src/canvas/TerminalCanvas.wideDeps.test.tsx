// @vitest-environment happy-dom
/** THE CANVAS'S PLACEMENT EDGES AT FLEET SIZE — 250 tiles on one host.
 *
 *  Placement wakes on three edges, and two of them used to walk every tile:
 *  "has every tile's metadata record arrived?" read one record per tile, and
 *  "how many tiles have no layout of their own?" read one layout per tile. A
 *  canvas with a few hundred tiles therefore put every tile on each of those
 *  memos, which Solid's development build judges `WIDE_SCOPE_DEPS` past 200
 *  sources.
 *
 *  What the test pins is the behaviour those edges exist for: a tile with no
 *  layout and a record present is placed at the camera; a tile with no layout
 *  and NO record is DEFERRED (it is indistinguishable from a returning tile
 *  whose saved layout is still in flight); and the deferred tile is placed in
 *  the flush its record arrives in. */

import type { TerminalId } from "kolu-common/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { render } from "@solidjs/web";
import { createStore, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

const mirror = vi.hoisted(() => ({
  /** A tile's saved layout, read off this file's store. */
  layout: ((_id: string) => undefined) as (
    id: string,
  ) => TileLayout | undefined,
  /** A tile's composed metadata record, likewise. */
  meta: ((_id: string) => undefined) as (id: string) => object | undefined,
}));

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({
    contentOf: (id: string) => ({
      kind: "terminal" as const,
      terminalId: id as TerminalId,
    }),
    isActiveTile: () => false,
    activeId: () => null,
    planActivateVisiblePane: () => () => {},
  }),
}));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: (id: string) => ({ repoColor: id }),
    getMetadata: (id: string) => mirror.meta(id),
    terminalIds: () => [],
  }),
}));
vi.mock("../hostScope/activeWire", () => {
  const sub = Object.assign(() => undefined, { pending: () => false });
  return { savedSessionSub: sub };
});
vi.mock("../terminal/staleness", () => ({ useStaleCheck: () => () => false }));
vi.mock("../ui/shown", () => ({ useShown: () => () => true }));
vi.mock("./useTileTheme", () => ({ useTileTheme: () => (id: string) => id }));
vi.mock("./useTileAura", () => ({ useTileAura: () => () => undefined }));
vi.mock("./useCanvasFocus", () => ({
  useCanvasFocus: () => ({ request: () => null, clear: () => {} }),
}));
vi.mock("./useCanvasCenterOnSwitch", () => ({
  useCanvasCenterOnSwitch: () => {},
}));
vi.mock("./useViewPosture", () => ({
  useViewPosture: () => ({ layout: () => "tiled", toggle: () => {} }),
}));
vi.mock("./viewport/useCanvasViewport", () => ({
  createContainerSizeObserver: () => {},
  useCanvasViewport: () => ({
    setContainerRef: () => {},
    releaseContainer: () => {},
    mounted: () => true,
    viewportCenter: () => ({ x: 0, y: 0 }),
    viewportSize: () => ({ w: 1200, h: 800 }),
    cameraSettled: () => true,
    canvasTransform: () => "",
    gridBgPosition: () => "",
    gridBgSize: () => "",
    panX: () => 0,
    panY: () => 0,
    zoom: () => 1,
    normalizeDelta: (x: number, y: number) => ({ dx: x, dy: y }),
    snapToGrid: (v: number) => v,
    centerOnTile: () => {},
    panTo: () => {},
  }),
}));
vi.mock("./dock/Dock", () => ({ default: () => null }));
vi.mock("./CanvasMinimap", () => ({ default: () => null }));
vi.mock("./CanvasTile", () => ({
  default: (props: {
    id: string;
    getLayout: (id: string) => TileLayout | undefined;
  }) => (
    <div
      data-testid="tile"
      data-id={props.id}
      data-layout={JSON.stringify(props.getLayout(props.id) ?? null)}
    />
  ),
}));

import TerminalCanvas from "./TerminalCanvas";
import { usePendingLayouts } from "./usePendingLayouts";

const TILES = 250;
const ids = Array.from({ length: TILES }, (_, n) => `tile-${n}`);
/** The tile with no saved layout whose record HAS arrived — placed. */
const NEW_TILE = "tile-7";
/** The tile with no saved layout and no record yet — deferred. */
const AWAITED_TILE = "tile-9";

/** A tile's saved box as this fixture holds it — the four numbers a layout
 *  carries, in a shape a leaf write can move (a wire layout is readonly). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const savedAt = (n: number): Box => ({
  x: n * 10,
  y: n * 20,
  w: 300,
  h: 200,
});

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  usePendingLayouts().clear();
});

it("places 250 tiles, deferring the one whose record is in flight", () => {
  const [state, setState] = createStore<{
    layouts: Record<string, Box>;
    metas: Record<string, { lastActivityAt: number }>;
  }>({
    layouts: Object.fromEntries(
      ids
        .filter((id) => id !== NEW_TILE && id !== AWAITED_TILE)
        .map((id, n) => [id, savedAt(n)]),
    ),
    metas: Object.fromEntries(
      ids
        .filter((id) => id !== AWAITED_TILE)
        .map((id, n) => [id, { lastActivityAt: n }]),
    ),
  });
  mirror.layout = (id) => state.layouts[id];
  mirror.meta = (id) => state.metas[id];
  takeSolidDiagnostics();

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={ids as never}
        getLayout={(id) => mirror.layout(id)}
        onLayoutChange={() => {}}
        planLayoutChange={() => () => {}}
        onSelect={() => {}}
        onClose={() => {}}
        onOpenWorkspaceSearch={() => {}}
        onCreate={() => {}}
        renderTileTitle={() => null}
        renderTileBody={() => null}
      />
    ),
    host,
  );
  flush();

  const painted = (): Record<string, TileLayout | null> =>
    Object.fromEntries(
      [...host.querySelectorAll<HTMLElement>('[data-testid="tile"]')].map(
        (el) => [
          el.dataset.id as string,
          JSON.parse(el.dataset.layout ?? "null") as TileLayout | null,
        ],
      ),
    );

  // Every tile with a saved layout paints it, unchanged.
  const first = painted();
  expect(Object.keys(first)).toHaveLength(TILES);
  for (const id of ids) {
    const saved = state.layouts[id];
    if (saved !== undefined) expect(first[id]).toEqual(saved);
  }
  // The new tile is placed at the camera; the awaited one is not placed at all.
  expect(first[NEW_TILE]).not.toBeNull();
  expect(first[AWAITED_TILE]).toBeNull();
  expect(diagnostics()).toEqual([]);

  // The awaited tile's record lands: it is a genuinely new tile now, so it is
  // placed — and nothing already placed moves.
  const placedNew = first[NEW_TILE];
  setState((s) => {
    s.metas[AWAITED_TILE] = { lastActivityAt: 1 };
  });
  flush();
  const second = painted();
  expect(second[AWAITED_TILE]).not.toBeNull();
  expect(second[NEW_TILE]).toEqual(placedNew);
  expect(second["tile-3"]).toEqual(state.layouts["tile-3"]);
  expect(diagnostics()).toEqual([]);

  // One tile's own layout moves: it paints the new value and no other tile
  // is re-placed.
  setState((s) => {
    const row = s.layouts["tile-200"];
    if (row !== undefined) row.x = 4242;
  });
  flush();
  const third = painted();
  expect(third["tile-200"]).toEqual({ ...savedAt(198), x: 4242 });
  expect(third[AWAITED_TILE]).toEqual(second[AWAITED_TILE]);
  expect(diagnostics()).toEqual([]);
});
