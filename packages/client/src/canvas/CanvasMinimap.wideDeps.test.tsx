// @vitest-environment happy-dom
/** THE MINIMAP'S BOUNDING BOX AT FLEET SIZE — 250 tiles on one board.
 *
 *  `bounds` walked every tile's layout on ONE memo: the layout lookup plus
 *  four corner leaves per tile, so a board of a few hundred tiles put well
 *  over 200 sources on it and Solid's development build judged it
 *  `WIDE_SCOPE_DEPS`. A canvas has no cap on tiles.
 *
 *  THE METADATA IS THE REAL STORE: records arrive through the real per-key
 *  `useCollection` view over real subscription stores
 *  (`../hostScope/hostWireMirror.testlib.ts`) and are read through the real
 *  `useTerminalMetadata` projection, with the layout prop spelled as
 *  `useTileStore`'s is — so one tile's reading costs what it costs in the
 *  browser.
 *
 *  What is pinned is the box itself: every tile's rectangle is placed from
 *  the padded bounding box of all of them, and the test computes that box
 *  from the fixture rather than from the product's fold. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createRoot, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  scope: undefined as unknown,
  meta: ((_id: string) => undefined) as (id: string) => object | undefined,
}));

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  padiMap: { entry: () => ({ clock: { toLocal: (at: number) => at } }) },
}));
vi.mock("../hostScope/hostScopes", () => ({ activeScope: () => held.scope }));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: (id: string) => ({
      repoColor: "#123456",
      key: { group: id, label: id, suffix: "" },
    }),
    getMetadata: (id: string) => held.meta(id),
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

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useTerminalMetadata } from "../terminal/useTerminalMetadata";
import CanvasMinimap from "./CanvasMinimap";
import { usePendingLayouts } from "./usePendingLayouts";

const TILES = 250;
const ids = Array.from({ length: TILES }, (_, n) => `tile-${n}` as TerminalId);

/** The minimap's own geometry, restated here so the expected rectangles are
 *  computed independently of the component's fold. */
const MAP_W = 180;
const MAP_H = 120;
const MAP_PAD = 100;

/** A tile's box as this fixture serves it. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxAt = (n: number): Box => ({
  x: n * 37,
  y: (n % 17) * 53,
  w: 300,
  h: 200,
});

const recordAt = (n: number, box: Box): PadiTerminal =>
  ({
    state: "active",
    parentId: null,
    lastActivityAt: n,
    canvasLayout: box,
  }) as unknown as PadiTerminal;

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
function expectedRect(boxes: ReadonlyArray<Box>, one: Box): Rect {
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
let disposeStore: (() => void) | undefined;
beforeEach(() => usePendingLayouts().clear());
afterEach(() => {
  dispose?.();
  disposeStore?.();
  dispose = undefined;
  disposeStore = undefined;
});

it("draws 250 tiles from one bounding box, with no wide memo", async () => {
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
      // The host scope as its readers take it: the retained wire, and the
      // per-host preferences the dock chrome reads.
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

  const boxes = new Map<TerminalId, Box>();
  for (const [n, id] of ids.entries()) {
    const box = boxAt(n);
    boxes.set(id, box);
    mirror.pushRecord(id, recordAt(n, box));
  }
  // The projection is PULLED: reading one slot builds the table and opens
  // every key's subscription, and the queued frames land on the settle after.
  held.meta(ids[0] as string);
  await settle();
  flush();

  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <CanvasMinimap
        shown={true}
        tileIds={[...ids]}
        getLayout={(id) =>
          // `useTileStore.getLayout`'s own spelling, over the real projection.
          (held.meta(id) as { canvasLayout?: TileLayout } | undefined)
            ?.canvasLayout
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
  const all = (): Box[] => ids.map((id) => boxes.get(id) as Box);

  expect(
    host.querySelectorAll('[data-testid="minimap-tile-rect"]'),
  ).toHaveLength(TILES);
  for (const id of ["tile-0", "tile-123", "tile-249"] as TerminalId[])
    sameRect(rectOf(id), expectedRect(all(), boxes.get(id) as Box));
  expect(diagnostics()).toEqual([]);

  // One tile moves far out: the box grows, so every rectangle is re-placed.
  const moved: Box = { ...boxAt(123), x: 20_000 };
  boxes.set("tile-123" as TerminalId, moved);
  mirror.pushRecord("tile-123" as TerminalId, recordAt(123, moved));
  await settle();
  flush();
  for (const id of ["tile-0", "tile-123", "tile-249"] as TerminalId[])
    sameRect(rectOf(id), expectedRect(all(), boxes.get(id) as Box));
  expect(diagnostics()).toEqual([]);
});
