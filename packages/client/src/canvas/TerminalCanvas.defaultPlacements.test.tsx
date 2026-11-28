// @vitest-environment happy-dom
/**
 * A DEFAULT LEAVES THE MAP WHEN THE TILE HAS A LAYOUT OF ITS OWN.
 *
 * `defaultPlacements` answers only for a tile that has no layout yet, and it
 * is a memo over a deliberately narrow edge set (the tile ids, the
 * all-records-settled flag, the viewport mount). Without an edge for the
 * layout itself the map never re-derived when a default-placed tile's layout
 * landed: the entry stayed, held across later passes, and a tile that lost its
 * layout again was answered from the STALE held position instead of being
 * placed afresh at the camera. The `unplacedCount` edge is that edge — it
 * ticks when a tile gains or loses a layout and never when an already-placed
 * tile's layout value changes.
 */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

const camera = vi.hoisted(() => ({
  center: { x: 0, y: 0 } as { x: number; y: number },
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
    // The metadata RECORD is present, so a tile with no layout is a genuinely
    // new tile and placement stamps a default instead of deferring.
    getMetadata: () => ({ lastActivityAt: 0 }),
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
// `usePendingLayouts` is REAL here: a withdrawal only re-places the tile if
// the override the user's last gesture left behind is genuinely released, and
// a stub that answers the saved value cannot see that.
vi.mock("./viewport/useCanvasViewport", () => ({
  createContainerSizeObserver: () => {},
  useCanvasViewport: () => ({
    setContainerRef: () => {},
    releaseContainer: () => {},
    mounted: () => true,
    viewportCenter: () => camera.center,
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

const TILE = "tile-1";
const FAR: TileLayout = { x: 9000, y: 9000, w: 300, h: 200 };

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  // The pending store is a module singleton.
  usePendingLayouts().clear();
});

it("re-places a tile from the current camera once its own layout has gone", () => {
  const [saved, setSaved] = createSignal<TileLayout | undefined>(undefined);
  camera.center = { x: 0, y: 0 };

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[TILE]}
        getLayout={() => saved()}
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
  const layout = (): TileLayout | null =>
    JSON.parse(
      host.querySelector<HTMLElement>('[data-testid="tile"]')?.dataset.layout ??
        "null",
    );

  // Placed by default at the camera it was created under.
  flush();
  const placed = layout();
  expect(placed).not.toBeNull();
  expect(Math.abs((placed as TileLayout).x)).toBeLessThan(1000);

  // The tile's own layout lands, far from that default: the saved value is
  // what the tile paints at, and the default leaves the map.
  setSaved(FAR);
  flush();
  expect(layout()).toEqual(FAR);

  // The layout is withdrawn (a record republished without one) while the
  // camera sits elsewhere. The tile is a new tile again, so it is placed at
  // the CURRENT camera — the stale default must not answer.
  camera.center = { x: 5000, y: 5000 };
  setSaved(undefined);
  flush();
  const replaced = layout();
  expect(replaced).not.toBeNull();
  expect((replaced as TileLayout).x).toBeGreaterThan(4000);
});

/** A RE-PLACED TILE IS PERSISTED, NOT JUST PAINTED.
 *
 *  `persistedDefaults` remembers which derived defaults have gone out through
 *  `planLayoutChange`, so a tile is written once. A tile that re-enters
 *  `defaultPlacements` — its layout withdrawn, so it is a new tile again —
 *  must be written AGAIN, with its fresh position; otherwise it paints at the
 *  new place here and stays layout-less everywhere else.
 *
 *  IS WITHDRAWAL REACHABLE? No padi writer ever clears `canvasLayout`:
 *  `setCanvasLayout` (`padi/src/terminals.ts:446-455`) only sets it, so a
 *  server that has one keeps it. The live path that delivers a record WITHOUT
 *  one is a session restore whose saved blob carries no layout for the tile
 *  (`padi/src/session/sessionRestore.ts:113-121` omits the key rather than
 *  spelling `undefined`). A tile whose record has not arrived at all is NOT
 *  this case — placement DEFERS it by design (`tilePlacementPlan.ts:45`) and
 *  writes nothing. The id is the same tile's throughout, which is what makes
 *  this a re-placement and not a new tile.
 *
 *  The tile is DRAGGED first, as a user's would have been: the gesture's
 *  override is released by its own echo, and a released override must not come
 *  back when the layout is withdrawn — it would read as a layout of its own,
 *  and nothing would be re-placed or written. */
it("writes the re-placed layout when a tile's own layout is withdrawn", () => {
  const [saved, setSaved] = createSignal<TileLayout | undefined>(undefined);
  const written: TileLayout[] = [];
  camera.center = { x: 0, y: 0 };

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[TILE]}
        getLayout={() => saved()}
        onLayoutChange={() => {}}
        planLayoutChange={() => (layout) => written.push(layout)}
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

  // The first default goes out once.
  flush();
  expect(written).toHaveLength(1);
  const first = written[0] as TileLayout;

  // Its own layout lands: the tile leaves the map, nothing more is written.
  setSaved(FAR);
  flush();
  expect(written).toHaveLength(1);

  // The user drags it, and that gesture's own echo lands: the override is
  // released, and the tile paints at the saved value alone.
  const DRAGGED: TileLayout = { x: 9500, y: 9400, w: 300, h: 200 };
  usePendingLayouts().setOne(TILE as TerminalId, DRAGGED, FAR);
  flush();
  setSaved(DRAGGED);
  flush();
  expect(written).toHaveLength(1);

  // Withdrawn under a moved camera: re-placed AND re-reported.
  camera.center = { x: 5000, y: 5000 };
  setSaved(undefined);
  flush();
  expect(written).toHaveLength(2);
  const second = written[1] as TileLayout;
  expect(second.x).toBeGreaterThan(4000);
  expect(second).not.toEqual(first);
});
