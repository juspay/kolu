// @vitest-environment happy-dom
/**
 * THE SWITCH-IN CENTERING RESOLVER RUNS ONCE.
 *
 * Switching hosts asks one question: does the incoming host's active tile need
 * the camera centred on it? The resolver defers until that tile has a layout —
 * and a brand-new tile's layout used to arrive by a WRITE. The canvas's
 * placement effect seeded `pending[id]` from an effect, so the resolver ran
 * once on nothing, then again on the seed it had just been handed: two passes
 * for one switch, with a frame in between that showed the tile unplaced.
 *
 * A new tile's default placement is DERIVED now (`defaultPlacements` in
 * `TerminalCanvas`), so the layout is readable in the flush that reveals the
 * tile and the resolver settles the switch on its first pass.
 *
 * The probe wraps the accessor the canvas hands the real hook: every resolver
 * pass that gets past the mount check reads it exactly once.
 */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

const probe = vi.hoisted(() => ({ reads: 0 }));
const host = vi.hoisted(() => ({
  key: (() => "host-a") as () => string,
  switchTo: (_key: string) => {},
}));
const tiles = vi.hoisted(() => ({
  active: (() => "tile-a") as () => string,
  activate: (_id: string) => {},
  centered: [] as string[],
}));

// The REAL centering hook, with the canvas's accessor counted.
vi.mock("./useCanvasCenterOnSwitch", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("./useCanvasCenterOnSwitch")>();
  return {
    useCanvasCenterOnSwitch: (layout: () => TileLayout | undefined) =>
      real.useCanvasCenterOnSwitch(() => {
        probe.reads++;
        return layout();
      }),
  };
});
vi.mock("../wire", async () => {
  const { createSignal } = await import("solid-js");
  const [key, setKey] = createSignal("host-a");
  host.key = key;
  host.switchTo = setKey;
  return { activeHost: key };
});
vi.mock("../hostScope/hostScopes", () => ({
  // A host that has never been positioned — the switch-in seed case.
  activeScope: () => ({
    camera: { positioned: () => false, snapshot: () => null },
  }),
}));
vi.mock("../terminal/useTerminalStore", async () => {
  // A mock factory is hoisted above the imports, so the module it needs can
  // only be reached dynamically.
  const { createSignal } = await import("solid-js");
  const [active, setActive] = createSignal("tile-a");
  tiles.active = active;
  tiles.activate = setActive;
  return {
    useTerminalStore: () => ({
      getDisplayInfo: (id: string) => ({ repoColor: id }),
      getMetadata: () => ({ lastActivityAt: 0 }),
      terminalIds: () => [],
      activeId: active,
      requestCenterActive: (id: string) => tiles.centered.push(id),
    }),
  };
});
vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({
    contentOf: (id: string) => ({ kind: "terminal", terminalId: id }),
    isActiveTile: (id: string) => id === tiles.active(),
    activeId: () => tiles.active(),
    planActivateVisiblePane: () => () => {},
  }),
}));
vi.mock("../hostScope/activeWire", () => {
  const sub = Object.assign(() => undefined, { pending: () => false });
  return { savedSessionSub: sub };
});
vi.mock("../terminal/staleness", () => ({ useStaleCheck: () => () => false }));
vi.mock("../ui/shown", () => ({ useShown: () => () => true }));
vi.mock("./useTileTheme", () => ({ useTileTheme: () => () => "moonlit" }));
vi.mock("./useTileAura", () => ({ useTileAura: () => () => undefined }));
vi.mock("./useCanvasFocus", () => ({
  useCanvasFocus: () => ({ request: () => null, clear: () => {} }),
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
    viewportCenter: () => ({ x: 2000, y: 1500 }),
    viewportSize: () => ({ width: 1200, height: 800 }),
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
    abortTransientInput: () => {},
  }),
}));
vi.mock("./dock/Dock", () => ({ default: () => null }));
vi.mock("./CanvasMinimap", () => ({ default: () => null }));
vi.mock("./CanvasTile", () => ({ default: () => null }));

import TerminalCanvas from "./TerminalCanvas";
import { usePendingLayouts } from "./usePendingLayouts";

const OLD_TILE = "tile-a" as TerminalId;
const NEW_TILE = "tile-b" as TerminalId;
const OLD_LAYOUT: TileLayout = { x: 0, y: 0, w: 300, h: 200 };

let dispose: (() => void) | undefined;
beforeEach(() => {
  usePendingLayouts().clear();
  probe.reads = 0;
  host.switchTo("host-a");
  tiles.activate(OLD_TILE);
  tiles.centered.length = 0;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("settles a host switch onto a new tile in one resolver pass", () => {
  const [tileIds, setTileIds] = createSignal<TerminalId[]>([OLD_TILE]);
  const saved = new Map<string, TileLayout>([[OLD_TILE, OLD_LAYOUT]]);

  const el = document.createElement("div");
  document.body.append(el);
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={tileIds()}
        getLayout={(id) => saved.get(id)}
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
    el,
  );
  flush();

  // The switch lands first: the incoming host's tiles have not arrived yet,
  // so the resolver defers (the mount race the hook documents).
  tiles.activate("");
  host.switchTo("host-b");
  setTileIds([]);
  flush();
  expect(tiles.centered).toEqual([]);

  // Now the host's tile arrives and becomes active in ONE flush — brand-new,
  // no saved layout, its metadata record already present.
  probe.reads = 0;
  tiles.activate(NEW_TILE);
  setTileIds([NEW_TILE]);
  flush();

  expect(tiles.centered).toEqual([NEW_TILE]); // the switch was serviced
  expect(probe.reads).toBe(1); // ONE resolver pass, not two
});
