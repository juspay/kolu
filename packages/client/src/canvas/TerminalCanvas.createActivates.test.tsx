// @vitest-environment happy-dom

/** A TERMINAL CREATED BESIDE AN EXISTING TILE BECOMES THE ACTIVE, FOCUSED ONE.
 *
 *  The create flow (`useTerminalCrud.handleCreate`) arms the inherited size,
 *  awaits the lifecycle RPC, and lands the new id with `setActiveSilently` —
 *  while the server's push (the key, then the composed record) arrives on its
 *  own schedule. The canvas's placement pass sees a brand-new tile, derives its
 *  default, reports it through the real layout writer, and LANDS the active one.
 *
 *  The fact this pins is the one the whole dev lane reads: after that sequence
 *  the NEW tile is the selection — `activeId()`, `focusedTerminalId()`, and the
 *  tile's own `data-active` / `data-focused` markers (`Terminal.tsx`'s
 *  `isFocused`, `CanvasTile`'s `active`). Both arrival orders are driven,
 *  because the push and the RPC's resolution race in production and neither
 *  order may leave the new tile unselected. Diagnostics stay empty throughout. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Effect, Stream } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

interface Record_ {
  readonly canvasLayout?: TileLayout;
}

interface Standing {
  readonly kind: "established";
  readonly ids: readonly TerminalId[];
}

const bag = vi.hoisted(() => ({
  keys: (() => [] as TerminalId[]) as () => TerminalId[],
  metaOf: (() => undefined) as (id: TerminalId) => Record_ | undefined,
  roster: (() => undefined) as () => Standing | undefined,
  saved: [] as { id: TerminalId; layout: TileLayout }[],
  // The server's ECHO of a layout write: the record this canvas reported for
  // comes back carrying it, which is how a derived default stops being one.
  echo: (() => {}) as (id: TerminalId, layout: TileLayout) => void,
  camera: { x: 0, y: 0 },
  queue: [] as TerminalId[][],
  wake: null as null | (() => void),
}));

// The wire is the ONE mock under the stores: `useTerminalStore`, `useTileStore`,
// `useSubPanel` and the per-host view are all REAL here, because the selection
// this pins is their answer.
vi.mock("../wire", async () => {
  const { encodeHostKey, decodeHostKey } = await import("kolu-common/hostKey");
  const terminals = {
    use: () => ({
      keys: () => bag.keys(),
      byKey: (id: TerminalId) =>
        bag.metaOf(id) !== undefined
          ? () => ({
              state: "active",
              git: { kind: "none" },
              cwd: "/work/repo",
              ...(bag.metaOf(id) as Record_),
            })
          : undefined,
    }),
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
  // THE ROSTER, REAL: the host's standing. `listIsCensus` — the fact the focus
  // derivation gates its auto-switch on — folds this against the key list, so a
  // stub that never establishes would leave that arm permanently off.
  const rosterCell = {
    use: () => ({
      value: () => bag.roster(),
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
            // The round trip: the daemon stores it and this host's collection
            // pushes the record back carrying the layout.
            setTimeout(() => bag.echo(id, layout), 0);
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

// The canvas's environment-bound parts: a measured viewport, the dock and
// minimap chrome, and the tile shell.
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
// The tile shell, carrying the TWO selection markers the e2e harness reads:
// `data-active` is `CanvasTile`'s own `active` prop (the canvas's
// `isActiveTile`), `data-focused` is what `Terminal.tsx` paints from the
// focused pane.
vi.mock("./CanvasTile", async () => {
  const { useTerminalStore } = await import("../terminal/useTerminalStore");
  return {
    default: (props: {
      id: string;
      active: boolean;
      getLayout: (id: string) => TileLayout | undefined;
    }) => {
      const store = useTerminalStore();
      return (
        <div
          data-testid="tile"
          data-id={props.id}
          data-active={props.active ? "" : undefined}
          data-focused={
            store.focusedTerminalId() === (props.id as TerminalId)
              ? ""
              : undefined
          }
          data-layout={JSON.stringify(props.getLayout(props.id) ?? null)}
        />
      );
    },
  };
});

import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import TerminalCanvas from "./TerminalCanvas";
import { usePendingLayouts } from "./usePendingLayouts";

const A = "tile-a" as TerminalId;
const B = "tile-b" as TerminalId;

const [ids, setIds] = createSignal<TerminalId[]>([]);
// The composed records, as the collection serves them: replaced wholesale, the
// way a server push lands.
const [records, setRecords] = createSignal(new Map<TerminalId, Record_>());
const [roster, setRoster] = createSignal<Standing | undefined>(undefined);
bag.keys = ids;
bag.metaOf = (id) => records().get(id);
bag.roster = roster;
bag.echo = (id, layout) => {
  setRecords((prev) =>
    new Map(prev).set(id, { ...prev.get(id), canvasLayout: layout }),
  );
};

/** The tile ORDER push — the keys stream's yield. A key whose record has not
 *  arrived yet is a tile placement DEFERS, exactly as in production. */
const pushKeys = (next: TerminalId[]): void => {
  setIds(next);
  bag.queue.push(next);
  bag.wake?.();
  bag.wake = null;
};
/** The host's STANDING — what it says it holds. */
const pushRoster = (held: TerminalId[]): void => {
  setRoster({ kind: "established", ids: held });
};
/** One terminal's composed record landing in the collection. */
const pushRecord = (id: TerminalId, rec: Record_): void => {
  setRecords((prev) => new Map(prev).set(id, rec));
};

/** Solid flushes the host scope's subscriptions on a microtask; a macrotask
 *  tick drains them. Named `settle` so it does not shadow Solid's `flush`. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let dispose: (() => void) | undefined;

beforeEach(() => {
  bag.saved.length = 0;
  bag.camera = { x: 0, y: 0 };
  setRecords(new Map());
  setRoster(undefined);
  pushKeys([]);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  usePendingLayouts().clear();
  document.body.replaceChildren();
});

const marked = (attr: string): (string | null)[] =>
  [...document.querySelectorAll(`[data-testid=tile][${attr}]`)].map((el) =>
    el.getAttribute("data-id"),
  );

/** ONE CREATE, as the product runs it. `handleCreate` arms the inherited size,
 *  awaits `lifecycle.create` and lands the new id with `setActiveSilently` —
 *  which accepts an id with no record precisely because creation answers that
 *  id a daemon round trip before this host's members carry it. The host then
 *  publishes the create on each of those members in turn, and only the last of
 *  them puts the id into the TILE census: the key list drops a key whose
 *  record has not arrived. That span is the CREATION GAP. */
async function create(
  id: TerminalId,
  held: TerminalId[],
  inherit: { w: number; h: number } | null,
): Promise<void> {
  bag.saved.length = 0;
  usePendingLayouts().setNextDefaultSize(inherit);
  // The resolved call lands the selection FIRST: the id is the caller's a
  // daemon round trip before any member carries it.
  useTerminalStore().setActiveSilently(id);
  flush();
  // Then the host publishes the create on its own members, each in its own
  // flush: the STANDING (the host holds the terminal now), the KEY LIST (the
  // tile order), and last the composed RECORD — which is the only one of the
  // three that puts the id into the tile census.
  pushRoster(held);
  flush();
  pushKeys(held);
  await settle();
  flush();
  pushRecord(id, {});
  flush();
  // The settled write phase drains and the server's layout echo lands.
  await settle();
  flush();
  await settle();
  flush();
}

it("lands the selection on a terminal created beside an existing tile", async () => {
  const tileStore = useTileStore();
  const store = useTerminalStore();
  // The connect: the standing is established and the list has answered, both
  // empty, so the canvas mounts on an empty workspace.
  pushRoster([]);
  pushKeys([]);
  await settle();

  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={tileStore.tileIds()}
        getLayout={(id) => tileStore.getLayout(id)}
        onLayoutChange={(id, layout) => tileStore.setLayout(id, layout)}
        // THE REAL WRITER — the registry's two-phase layout seam.
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
  flush();
  await settle();
  flush();

  // THE FIRST TILE, on an empty canvas.
  await create(A, [A], null);
  expect(store.focusedTerminalId()).toBe(A);
  expect(tileStore.activeId()).toBe(A);
  expect(marked("data-active")).toEqual([A]);
  const first = tileStore.getLayout(A);
  expect(first).toBeDefined();
  takeSolidDiagnostics();

  // THE SECOND, created BESIDE it — the shape the whole dev lane drives.
  await create(B, [A, B], { w: first?.w ?? 0, h: first?.h ?? 0 });

  expect(takeSolidDiagnostics()).toEqual([]);
  // The new tile is the selection, through every face of it.
  expect(store.focusedTerminalId()).toBe(B);
  expect(tileStore.activeId()).toBe(B);
  expect(marked("data-active")).toEqual([B]);
  expect(marked("data-focused")).toEqual([B]);
  // And its derived default went out through the real writer.
  expect(bag.saved.map((w) => w.id)).toEqual([B]);
});
