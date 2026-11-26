// @vitest-environment happy-dom
/**
 * A GESTURE IS MINTED AGAINST THE LAYOUT IT WAS COMPUTED FROM.
 *
 * The canvas mints a pending override with the layout the gesture started
 * from. For a brand-new tile that layout is the default this canvas DERIVED
 * and wrote out through `planLayoutChange` — it is not the tile's saved value,
 * which is still `undefined`. Minting against the saved value instead made the
 * default's own echo read as a FOREIGN layout: the override was dropped, and
 * the tile snapped back to its default out from under the pointer (and stopped
 * following it for the rest of the gesture).
 *
 * The same ports also prove PREVIEW frames stay off the authored trail: only
 * values this client sends can ever echo, so only those are worth remembering.
 *
 * The gestures are driven through the minimap's real ports (the canvas builds
 * them in `onStartTileDrag`), which are the canvas's own `preview`/`commit`
 * wiring — the resize handles' `onMove`/commit pair goes through the same two
 * helpers.
 */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

const camera = vi.hoisted(() => ({
  center: { x: 0, y: 0 } as { x: number; y: number },
}));
/** The minimap's drag ports, as the canvas hands them out. */
const minimap = vi.hoisted(() => ({
  startTileDrag: null as
    | ((id: string) => {
        preview: (dx: number, dy: number) => void;
        commit: (dx: number, dy: number) => void;
      } | null)
    | null,
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
// The real minimap only needs its ports called; this stub captures them.
vi.mock("./CanvasMinimap", () => ({
  default: (props: { onStartTileDrag: typeof minimap.startTileDrag }) => {
    minimap.startTileDrag = props.onStartTileDrag;
    return null;
  },
}));
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
import { authoredTrailLength, usePendingLayouts } from "./usePendingLayouts";

const TILE = "tile-1";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  minimap.startTileDrag = null;
  // The pending store is a module singleton.
  usePendingLayouts().clear();
});

/** Mount the canvas over one tile with no saved layout, with the server's
 *  saved value under the test's control. */
function mountCanvas() {
  const [saved, setSaved] = createSignal<TileLayout | undefined>(undefined);
  const written: TileLayout[] = [];
  camera.center = { x: 0, y: 0 };
  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[TILE]}
        getLayout={() => saved()}
        onLayoutChange={(_id, layout) => written.push(layout)}
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
  flush();
  const layout = (): TileLayout | null =>
    JSON.parse(
      host.querySelector<HTMLElement>('[data-testid="tile"]')?.dataset.layout ??
        "null",
    );
  const ports = () => {
    const start = minimap.startTileDrag;
    if (!start) throw new Error("the minimap was never handed its ports");
    const p = start(TILE);
    if (!p) throw new Error("the tile has no layout to drag from");
    return p;
  };
  return { layout, setSaved, written, ports };
}

it("keeps a gesture minted on a derived default when that default echoes", () => {
  const canvas = mountCanvas();
  // Placed by derivation, and written out: that write is the value the server
  // will echo back.
  const derived = canvas.layout();
  expect(derived).not.toBeNull();
  expect(canvas.written).toEqual([derived]);

  // The user drags the tile before the default has echoed.
  canvas.ports().commit(40, 25);
  flush();
  const dragged = canvas.layout();
  expect(dragged).toEqual({
    ...(derived as TileLayout),
    x: (derived as TileLayout).x + 40,
    y: (derived as TileLayout).y + 25,
  });

  // The DEFAULT's echo lands — this client's own earlier write catching up.
  // The gesture must stand; the tile must not snap back.
  canvas.setSaved(derived as TileLayout);
  flush();
  expect(canvas.layout()).toEqual(dragged);
});

it("keeps following the pointer when the default echoes mid-gesture", () => {
  const canvas = mountCanvas();
  const derived = canvas.layout() as TileLayout;
  const drag = canvas.ports();

  drag.preview(10, 10);
  flush();
  canvas.setSaved(derived); // the default's echo, mid-drag
  flush();
  drag.preview(60, 30);
  flush();

  expect(canvas.layout()).toEqual({
    ...derived,
    x: derived.x + 60,
    y: derived.y + 30,
  });
});

it("leaves the authored trail at the number of committed writes", () => {
  const canvas = mountCanvas();
  const drag = canvas.ports();
  // The base alone: the derived default the gesture was minted against.
  for (let i = 1; i <= 50; i++) drag.preview(i, i);
  flush();
  expect(authoredTrailLength(TILE)).toBe(1);

  // One commit — the only value that went on the wire.
  drag.commit(50, 50);
  flush();
  expect(authoredTrailLength(TILE)).toBe(2);

  for (let i = 1; i <= 50; i++) drag.preview(i, i);
  flush();
  expect(authoredTrailLength(TILE)).toBe(2);
});
