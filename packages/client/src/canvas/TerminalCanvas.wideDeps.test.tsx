// @vitest-environment happy-dom
/** THE CANVAS'S PLACEMENT EDGES AT FLEET SIZE — 250 tiles on one host.
 *
 *  Placement wakes on three edges, and two of them used to walk every tile:
 *  "has every tile's metadata record arrived?" read one record per tile, and
 *  "how many tiles have no layout of their own?" read one layout per tile.
 *  The first-mount centring effect walked the whole board again for its
 *  bounding box. A canvas with a few hundred tiles therefore put every tile
 *  on each of those scopes, which Solid's development build judges
 *  `WIDE_SCOPE_DEPS` past 200 sources.
 *
 *  THE METADATA IS THE REAL STORE: records arrive through the real per-key
 *  `useCollection` view over real subscription stores
 *  (`../hostScope/hostWireMirror.testlib.ts`), read through the real
 *  `useTerminalMetadata` projection, and the layout prop is spelled as
 *  `useTileStore`'s is — `getMetadata(id)?.canvasLayout`. So one tile's
 *  reading costs what it costs in the browser, which a plain mocked record
 *  under-measures about threefold.
 *
 *  What the test pins is the behaviour those edges exist for: a tile with no
 *  layout and a record present is placed at the camera; a tile with no layout
 *  and NO record is DEFERRED (it is indistinguishable from a returning tile
 *  whose saved layout is still in flight); and the deferred tile is placed in
 *  the flush its record arrives in. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

// `useCollection` opens each key's stream through this; the mirror's
// procedure IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  /** The active host's scope, as `useTerminalMetadata` reads it. */
  scope: undefined as unknown,
  /** One tile's record, through the real metadata projection. */
  meta: ((_id: string) => undefined) as (id: string) => object | undefined,
}));

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  // The host's clock, which the metadata projection reprojects through.
  padiMap: { entry: () => ({ clock: { toLocal: (at: number) => at } }) },
}));
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => held.scope,
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
    getMetadata: (id: string) => held.meta(id),
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

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useTerminalMetadata } from "../terminal/useTerminalMetadata";
import TerminalCanvas from "./TerminalCanvas";
import { usePendingLayouts } from "./usePendingLayouts";

const TILES = 250;
const ids = Array.from({ length: TILES }, (_, n) => `tile-${n}` as TerminalId);
/** The tile with no saved layout whose record HAS arrived — placed. */
const NEW_TILE = "tile-7" as TerminalId;
/** The tile with no saved layout and no record yet — deferred. */
const AWAITED_TILE = "tile-9" as TerminalId;

const savedAt = (n: number): TileLayout => ({
  x: n * 10,
  y: n * 20,
  w: 300,
  h: 200,
});

/** A composed tile record as the wire serves one — with or without a layout
 *  of its own. */
const recordAt = (n: number, layout: TileLayout | undefined): PadiTerminal =>
  ({
    state: "active",
    parentId: null,
    lastActivityAt: n,
    ...(layout === undefined ? {} : { canvasLayout: layout }),
  }) as unknown as PadiTerminal;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let disposeStore: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  disposeStore?.();
  dispose = undefined;
  disposeStore = undefined;
  usePendingLayouts().clear();
});

it("places 250 tiles, deferring the one whose record is in flight", async () => {
  const mirror = hostWireMirror();
  const entry = mirror.entry as {
    collections: {
      terminals: { use: (options: { keys: () => TerminalId[] }) => unknown };
    };
  };
  takeSolidDiagnostics();
  const metadata = createRoot((disposeRoot) => {
    disposeStore = disposeRoot;
    held.scope = {
      wire: {
        terminals: entry.collections.terminals.use({ keys: () => [...ids] }),
      },
      prefs: {
        activityWindow: () => "all" as const,
        setActivityWindow: () => {},
      },
    };
    return useTerminalMetadata({ list: () => ids });
  });
  held.meta = (id) => metadata.getMetadata(id as TerminalId);

  /** The layout each tile was served with — the test's own record of it. */
  const saved = new Map<TerminalId, TileLayout>();
  for (const [n, id] of ids.entries()) {
    if (id === AWAITED_TILE) continue;
    const layout = id === NEW_TILE ? undefined : savedAt(n);
    if (layout !== undefined) saved.set(id, layout);
    mirror.pushRecord(id, recordAt(n, layout));
  }
  // The projection is PULLED: reading one slot builds the table and opens
  // every key's subscription, and the frames queued above land on the settle
  // after that read.
  held.meta(ids[0] as string);
  await settle();
  flush();

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[...ids] as never}
        getLayout={(id) =>
          // `useTileStore.getLayout`'s own spelling, over the real projection.
          (held.meta(id) as { canvasLayout?: TileLayout } | undefined)
            ?.canvasLayout
        }
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
  for (const [id, layout] of saved) expect(first[id]).toEqual(layout);
  // The new tile is placed at the camera; the awaited one is not placed at all.
  expect(first[NEW_TILE]).not.toBeNull();
  expect(first[AWAITED_TILE]).toBeNull();
  expect(diagnostics()).toEqual([]);

  // The awaited tile's record lands with no layout of its own: it is a
  // genuinely new tile now, so it is placed — and nothing already placed moves.
  const placedNew = first[NEW_TILE];
  mirror.pushRecord(AWAITED_TILE, recordAt(9, undefined));
  await settle();
  flush();
  const second = painted();
  expect(second[AWAITED_TILE]).not.toBeNull();
  expect(second[NEW_TILE]).toEqual(placedNew);
  expect(second["tile-3"]).toEqual(saved.get("tile-3" as TerminalId));
  expect(diagnostics()).toEqual([]);

  // One tile's own layout moves: it paints the new value and no other tile
  // is re-placed.
  const moved = { ...savedAt(200), x: 4242 };
  mirror.pushRecord("tile-200" as TerminalId, recordAt(200, moved));
  await settle();
  flush();
  const third = painted();
  expect(third["tile-200"]).toEqual(moved);
  expect(third[AWAITED_TILE]).toEqual(second[AWAITED_TILE]);
  expect(third["tile-3"]).toEqual(saved.get("tile-3" as TerminalId));
  expect(diagnostics()).toEqual([]);
});
