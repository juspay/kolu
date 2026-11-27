// @vitest-environment happy-dom

/** THE DERIVED-DEFAULT PLACEMENT PASS DOES NOT TEAR WHAT READS THE TILE'S CHROME.
 *
 *  `persistDerivedDefaults` (`TerminalCanvas.tsx`) places every brand-new tile,
 *  reports each default through the REAL layout writer — `useTileStore.planSetLayout`
 *  → `persistCanvasLayout` → the RPC — and then LANDS the active one. That landing
 *  writes the tile's pane chrome (`useSubPanel`'s `state.<terminal-uuid>` store),
 *  which a tile's own content reads beside the WebGL gate `useTerminalStore`'s
 *  `webglTileBudget` answers. Written inline from the effect's apply arm, that write
 *  relays into a consumer which has already run this flush: run R's largest finding,
 *  `EFFECT_RELAY_TEAR` on `useTerminalStore.ts:63`'s budget (242 lines over 68
 *  scenarios, `info` only because each terminal's uuid is its own counter key).
 *
 *  Two tiles land in the first pass and a third arrives the way a create does — its
 *  key first, its record after — and the budget is read the way a tile's own subtree
 *  reads it (`holdsWebgl`), paired with the chrome. The assertion is that
 *  `takeSolidDiagnostics()` is EMPTY, info included, so the tear fails at its FIRST
 *  sighting rather than at the third the dev lane needs, while every default still
 *  goes out through the real writer and the landing still stands. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Effect, Stream } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

interface Record_ {
  readonly canvasLayout?: TileLayout;
}

const bag = vi.hoisted(() => ({
  keys: (() => [] as TerminalId[]) as () => TerminalId[],
  metaOf: (() => undefined) as (id: TerminalId) => Record_ | undefined,
  saved: [] as { id: TerminalId; layout: TileLayout }[],
  // The flush's running order: every layout write the real writer issues, and
  // every run of the probe effect mounted BESIDE the canvas. A write issued
  // from inside the placement arm lands before that probe; a settled one lands
  // after this flush's effects have all run.
  log: [] as string[],
  camera: { x: 0, y: 0 },
  // The key-stream side of a push: production's tile order rides a STREAM
  // (`terminals.unenrolledKeys`), and the per-host view derives its tile list —
  // and through it the MRU the budget reads — from that, not from the record
  // collection. One queue, drained by the generator below.
  queue: [] as TerminalId[][],
  wake: null as null | (() => void),
}));

// The wire is the ONE mock under the stores: `useTerminalStore`, `useTileStore`,
// `useSubPanel` and the per-host view are all REAL here, because the victim memo
// (`webglTileBudget`) and the chrome store the landing writes are exactly what this
// pins. `setCanvasLayout` records the write the real `persistCanvasLayout` makes.
vi.mock("../wire", async () => {
  // `vi.mock` factories are hoisted above this file's imports, so the codec has
  // to be reached from inside the factory.
  const { encodeHostKey, decodeHostKey } = await import("kolu-common/hostKey");
  const terminals = {
    use: () => ({
      keys: () => bag.keys(),
      byKey: (id: TerminalId) =>
        bag.metaOf(id) !== undefined
          ? () => ({
              // What every composed record carries and the display derivation
              // reads; this fixture is about layout, so these are constants.
              state: "active",
              git: { kind: "none" },
              cwd: "/work/repo",
              ...(bag.metaOf(id) as Record_),
            })
          : undefined,
    }),
    // An async generator, because the stream must stay OPEN between pushes the
    // way the server's does.
    unenrolledKeys: () =>
      Stream.fromAsyncIterable(
        (async function* keys() {
          for (;;) {
            if (bag.queue.length === 0) {
              const { promise, resolve } = Promise.withResolvers<void>();
              bag.wake = resolve;
              await promise;
            }
            yield bag.queue.shift() as TerminalId[];
          }
        })(),
        (cause) => cause,
      ),
  };
  const stubCell = {
    use: () => ({
      value: () => undefined,
      sub: Object.assign(() => undefined, {
        pending: () => false,
        error: () => undefined,
        complete: () => false,
      }),
    }),
  };
  // THE ROSTER, ESTABLISHED over the keys this fixture has pushed: the host
  // says it holds exactly what its list carries. `listIsCensus` folds the two,
  // and it is what the focus derivation gates its auto-switch on — a roster
  // that never establishes would switch that arm off and leave every landing
  // below ungraded.
  const rosterCell = {
    use: () => ({
      value: () => ({ kind: "established", ids: bag.keys() }),
      sub: Object.assign(() => undefined, {
        pending: () => false,
        error: () => undefined,
        complete: () => false,
      }),
    }),
  };
  const stubCollection = {
    use: () => ({ keys: () => [], byKey: () => undefined }),
  };
  const entry = () => ({
    clock: { toLocal: (ms: number) => ms },
    collections: { terminals, daemonStatus: stubCollection },
    cells: { session: stubCell, roster: rosterCell, activityFeed: stubCell },
    procedures: { chrome: { setActive: async () => {} } },
  });
  return {
    padiMap: {
      entries: {
        use: () => ({ keys: () => [LOCAL_HOST], byKey: () => undefined }),
      },
      codec: { encode: encodeHostKey, decode: decodeHostKey },
      live: () => true,
      entry,
      useEntry: entry,
    },
    activeHost: () => LOCAL_HOST,
    groundedActiveHost: () => LOCAL_HOST,
    // `createViewState`'s active report — fire-and-forget, nothing asserts it.
    padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
    activePadiRpc: {
      chrome: {
        setCanvasLayout: ({
          id,
          layout,
        }: {
          id: TerminalId;
          layout: TileLayout;
        }) =>
          Effect.sync(() => {
            bag.saved.push({ id, layout });
            bag.log.push(`write:${id}`);
          }),
      },
    },
  };
});
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

// The canvas's environment-bound parts: a measured viewport, the dock and minimap
// chrome, and the tile shell. The TILE still reads the budget — that read is the
// relay's victim, and a shell that dropped it would grade nothing.
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
    viewportCenter: () => bag.camera,
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
vi.mock("./CanvasTile", async () => {
  const { useTerminalStore } = await import("../terminal/useTerminalStore");
  const { useSubPanel } = await import("../terminal/useSubPanel");
  return {
    default: (props: {
      id: string;
      getLayout: (id: string) => TileLayout | undefined;
    }) => {
      const store = useTerminalStore();
      const panel = useSubPanel();
      return (
        <div
          data-testid="tile"
          data-id={props.id}
          // The tile's subtree reads its PANE CHROME and the WebGL budget in one
          // binding, the way the real tile's content does: which pane shows, and
          // whether this tile may hold a renderer. That pairing is what the
          // placement pass's landing walks into — it writes the chrome, so this
          // binding re-runs and asks the budget again.
          data-nonce={String(
            panel.paneChrome(props.id as TerminalId).refocusNonce,
          )}
          data-webgl={String(store.holdsWebgl(props.id as TerminalId))}
          data-layout={JSON.stringify(props.getLayout(props.id) ?? null)}
        />
      );
    },
  };
});

import { render } from "@solidjs/web";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { useSubPanel } from "../terminal/useSubPanel";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import TerminalCanvas from "./TerminalCanvas";
import { usePendingLayouts } from "./usePendingLayouts";

const A = "tile-a" as TerminalId;
const B = "tile-b" as TerminalId;
const C = "tile-c" as TerminalId;

const [ids, setIds] = createSignal<TerminalId[]>([]);
// The composed records, as the collection serves them: replaced wholesale, the
// way a server push lands, so a record's own fields are reactive too.
const [records, setRecords] = createSignal(new Map<TerminalId, Record_>());
bag.keys = ids;
bag.metaOf = (id) => records().get(id);
/** The tile ORDER push — the keys stream's yield. A key whose record has not
 *  arrived yet is a tile placement DEFERS, exactly as in production. */
const pushKeys = (next: TerminalId[]): void => {
  setIds(next);
  bag.queue.push(next);
  bag.wake?.();
  bag.wake = null;
};
/** The RECORD push — one terminal's composed record landing in the collection. */
const pushRecords = (entries: [TerminalId, Record_][]): void => {
  setRecords(new Map(entries));
};

/** Solid flushes the host scope's subscriptions on a microtask; a macrotask
 *  tick drains them. Named `settle` so it does not shadow Solid's `flush`. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let dispose: (() => void) | undefined;
let disposeProbe: (() => void) | undefined;

beforeEach(() => {
  bag.saved.length = 0;
  bag.log.length = 0;
  bag.camera = { x: 0, y: 0 };
  pushRecords([]);
  pushKeys([]);
});

afterEach(() => {
  disposeProbe?.();
  disposeProbe = undefined;
  dispose?.();
  dispose = undefined;
  // Both are module singletons.
  usePendingLayouts().clear();
  document.body.replaceChildren();
});

it("places and lands new tiles with no tear in the WebGL budget", async () => {
  // TWO layout-less records in one push: both are brand-new tiles, so one
  // placement pass derives a default for each, reports both through the real
  // writer, and LANDS the active one.
  pushRecords([
    [A, {}],
    [B, {}],
  ]);
  pushKeys([A, B]);
  await settle();

  const tileStore = useTileStore();
  // Active before the pass runs, so the same arm both writes and lands.
  tileStore.activate(A);
  flush();
  expect(tileStore.activeId()).toBe(A);

  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={tileStore.tileIds()}
        getLayout={(id) => tileStore.getLayout(id)}
        onLayoutChange={(id, layout) => tileStore.setLayout(id, layout)}
        // THE REAL WRITER — the registry's two-phase layout seam, through to
        // `persistCanvasLayout` and the RPC. No spy stands in for it.
        planLayoutChange={tileStore.planSetLayout}
        onSelect={(id) => tileStore.activate(id)}
        onClose={() => {}}
        onOpenWorkspaceSearch={() => {}}
        onCreate={() => {}}
        renderTileTitle={() => null}
        renderTileBody={() => null}
      />
    ),
    host,
  );
  // A consumer that pairs a tile's PANE CHROME with the WebGL gate — the pairing
  // the real tile content reads — mounted after the canvas, so the placement
  // pass's landing (which writes that chrome) re-runs it inside the same flush
  // and it asks the budget again. That second ask is where an effect-origin
  // write is graded.
  const panel = useSubPanel();
  const store = useTerminalStore();
  disposeProbe = createRoot((d) => {
    createEffect(
      () =>
        [A, B, C].map((id) => ({
          nonce: panel.paneChrome(id).refocusNonce,
          webgl: store.holdsWebgl(id),
        })),
      (seen) => {
        bag.log.push(`chrome+budget:${seen.map((s) => s.webgl).join(",")}`);
      },
      { name: "tileChromeAndBudget" },
    );
    return d;
  });
  flush();
  await settle();
  flush();
  const webgl = (): (string | null)[] =>
    [...host.querySelectorAll("[data-testid=tile]")].map((el) =>
      el.getAttribute("data-webgl"),
    );

  // Graded at its FIRST sighting: info included, nothing at all.
  expect(takeSolidDiagnostics()).toEqual([]);
  // Both defaults went out through the real writer, once each.
  expect(bag.saved.map((w) => w.id)).toEqual([A, B]);
  // And both tiles paint ADMITTED — the attribute and the budget it came from
  // agree once the flush is over.
  expect(webgl()).toEqual(["true", "true"]);
  // The landing stands — the active tile's own main pane is the focused one.
  expect(useSubPanel().paneChrome(A).activeSubTab).toBeNull();
  // THE BEHAVIOUR, not just the absence of a finding: the tile the pass landed
  // on is the one the canvas and the dock read as active, and the one input
  // goes to. An empty diagnostics list says the engine saw no tear; it says
  // nothing about whether the answer survived.
  expect(tileStore.activeId()).toBe(A);
  expect(store.focusedTerminalId()).toBe(A);

  // THE SECOND SHAPE — a tile arriving later, the way a create does. The
  // selection is landed on the new id FIRST (creation answers it a daemon
  // round trip before any member carries it); then its key arrives and
  // placement DEFERS it (no record yet, `tilePlacementPlan`); then its record
  // lands and that flush places it, reports it through the same writer and
  // lands it. The standing leads the key stream by a tick here exactly as it
  // does in production — the roster is a cell, the key list a stream.
  bag.saved.length = 0;
  bag.log.length = 0;
  takeSolidDiagnostics();
  const placed = (id: TerminalId): TileLayout =>
    tileStore.getLayout(id) as TileLayout;
  const [savedA, savedB] = [placed(A), placed(B)];
  tileStore.activate(C);
  flush();
  pushKeys([A, B, C]);
  await settle();
  flush();
  bag.log.length = 0;
  takeSolidDiagnostics();

  bag.camera = { x: 5000, y: 5000 };
  pushRecords([
    [A, { canvasLayout: savedA }],
    [B, { canvasLayout: savedB }],
    [C, {}],
  ]);
  flush();

  expect(takeSolidDiagnostics()).toEqual([]);
  // The flush's shape, which is what the grade is about: the consumer runs for
  // the record that arrived, the pass reports the layout, and the landing beside
  // it makes the consumer ask the budget a second time. Settled, that second ask
  // carries no effect origin; inline, it is the tear.
  expect(bag.log).toEqual([
    "chrome+budget:true,true,true",
    `write:${C}`,
    "chrome+budget:true,true,true",
  ]);
  expect(bag.saved.map((w) => w.id)).toEqual([C]);
  expect(bag.saved[0]?.layout.x).toBeGreaterThan(4000);
  expect(webgl()).toEqual(["true", "true", "true"]);
  // And the tile that arrived is the active, focused one — through the whole
  // gap between its key and its record.
  expect(tileStore.activeId()).toBe(C);
  expect(store.focusedTerminalId()).toBe(C);
});
