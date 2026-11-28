// @vitest-environment happy-dom
/**
 * A TILE RENDERS THE TERMINAL IT HOLDS, still. The content dispatch's `<Match>`
 * is not keyed, so its child body runs ONCE — a strict-read window — and the
 * terminal id read there froze for the life of the tile (and raised
 * STRICT_READ_UNTRACKED on every canvas tile). The id travels as an accessor
 * now, read inside `renderTerminalTile`'s own JSX.
 */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TileContent } from "../tile/tileContent";

const content = vi.hoisted(() => ({
  of: (() => undefined) as (id: string) => TileContent | undefined,
  mounts: 0,
}));

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({
    contentOf: (id: string) => content.of(id),
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
// The id under test reaches the tile through the theme lookup, which takes the
// TERMINAL id — so the stub below paints whatever id the dispatch handed down.
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
vi.mock("./usePendingLayouts", () => ({
  usePendingLayouts: () => ({
    setOne: () => {},
    previewOne: () => {},
    clear: () => {},
    dropIds: () => {},
    deadIds: () => [],
    hasOverride: () => false,
    claimNextDefaultSize: () => null,
    resolveLayout: (_id: string, saved: unknown) => saved,
    publishDerivedDefault: () => {},
    forgetDerivedDefault: () => {},
  }),
}));
vi.mock("./viewport/useCanvasViewport", () => ({
  createContainerSizeObserver: () => {},
  useCanvasViewport: () => ({
    setContainerRef: () => {},
    releaseContainer: () => {},
    mounted: () => false,
    viewportCenter: () => null,
    viewportSize: () => undefined,
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
  default: (props: { id: string; theme: string }) => {
    content.mounts++;
    return (
      <div data-testid="tile" data-id={props.id} data-theme={props.theme} />
    );
  },
}));

import TerminalCanvas from "./TerminalCanvas";

const TILE = "tile-1";
const ONE = "one" as TerminalId;
const TWO = "two" as TerminalId;

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("follows the terminal its tile holds when the content changes", () => {
  const [terminalId, setTerminalId] = createSignal<TerminalId>(ONE);
  content.of = (id) =>
    id === TILE ? { kind: "terminal", terminalId: terminalId() } : undefined;

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[TILE]}
        getLayout={() => ({ x: 0, y: 0, w: 300, h: 200 })}
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
  const theme = () =>
    host.querySelector<HTMLElement>('[data-testid="tile"]')?.dataset.theme;

  expect(theme()).toBe(ONE);

  setTerminalId(TWO);
  flush();
  expect(theme()).toBe(TWO);
});

it("churning the tile set leaves a tile's content dispatch alone", () => {
  // `contentOf` mints a FRESH content object per call over the tracked tile
  // set, so every add and remove re-runs this tile's content read with the
  // same answer — the shape Solid's dev attribution reports as an unstable
  // memo output once four consecutive runs do it.
  const [present, setPresent] = createSignal<string[]>([TILE]);
  content.of = (id) =>
    present().includes(id) ? { kind: "terminal", terminalId: ONE } : undefined;
  content.mounts = 0;

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[TILE]}
        getLayout={() => ({ x: 0, y: 0, w: 300, h: 200 })}
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
  expect(content.mounts).toBe(1);

  for (let cycle = 1; cycle <= 5; cycle++) {
    setPresent(cycle % 2 === 1 ? [TILE, "tile-2"] : [TILE]);
    flush();
  }

  expect(content.mounts).toBe(1);
  expect(
    host.querySelector<HTMLElement>('[data-testid="tile"]')?.dataset.theme,
  ).toBe(ONE);
});
