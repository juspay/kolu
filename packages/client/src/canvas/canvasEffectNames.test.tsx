// @vitest-environment happy-dom
/**
 * THE CANVAS'S EFFECTS MUST BE TOLD APART IN A REPORT.
 *
 * `@solidjs/compiler` 2.0.3 names no effect — declared or not — so an effect's
 * reported location is its nearest located OWNER's: the `<TerminalCanvas>` JSX
 * site in `App.tsx`. Every effect in this component therefore folds into ONE
 * report key, which is how two different dev-lane findings arrived at the same
 * `App.tsx:716:27 effect` row and could not be addressed
 * (`governance/primitiveNames.ts`, the effects paragraph). The repair is a
 * hand-written `{ name }` per effect, and this file is what judges it: a
 * finding raised BY one of those effects must carry that effect's own name.
 *
 * The finding is DRIVEN IN through the one per-tile read that effect still
 * makes. The canvas's own whole-board folds are chunked now — one row memo
 * per tile, which `TerminalCanvas.wideDeps.test.tsx` judges — so no read of
 * the canvas's own is wide any more; what the centring effect does read in
 * its compute is the ACTIVE tile's layout, through the `getLayout` PROP its
 * caller owns. The fixture below hands it a caller whose lookup for that one
 * tile reads 300 signals, and that is what makes the effect's scope wide.
 * Past `WIDE_SCOPE_DEPS`' budget Solid names the subscriber, and the name
 * has to be `centerOnFirstMount` rather than the bare `effect` every other
 * effect in the component would also answer to.
 *
 * Everything around the canvas's own reactive wiring is stood in, as in
 * `canvasStrictReads.test.tsx`: the stores, the per-tile presentation helpers,
 * the tile chrome and body, and `ResizeObserver`, which happy-dom does not
 * deliver.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { render } from "@solidjs/web";
import { type Accessor, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileContent } from "../tile/tileContent";
import type { TileLayout } from "./TileLayout";

const content = vi.hoisted(() => ({
  of: (() => undefined) as (id: string) => TileContent | undefined,
}));
const tiles = vi.hoisted(() => ({ ids: (() => []) as () => string[] }));
/** The tile the canvas centres on — and the one whose layout lookup is wide. */
const ACTIVE_TILE = "tile-0";

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({
    contentOf: (id: string) => content.of(id),
    isActiveTile: (id: string) => id === ACTIVE_TILE,
    isFocused: () => false,
    // The canvas centres on the ACTIVE tile, and resolves that tile's layout
    // through the layout prop — the read this file widens.
    activeId: () => ACTIVE_TILE,
    activate: () => {},
    tileIds: () => tiles.ids(),
    planActivateVisiblePane: () => () => {},
  }),
}));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: (id: string) => ({
      repoColor: id,
      annotationColor: id,
      subCount: 0,
      key: { group: "repo", label: "main" },
    }),
    activeId: () => null,
    getMetadata: () => ({ lastActivityAt: 0 }),
    metadataOf: () => ({ lastActivityAt: 0 }),
    terminalIds: () => tiles.ids(),
    getPaneTree: () => [],
    getSplitPaneIds: () => [],
    containingTile: (id: string) => id,
    parentEdge: () => undefined,
    focusedTerminalId: () => null,
    focusTerminal: () => {},
    isUnread: () => false,
  }),
}));
vi.mock("../hostScope/activeWire", () => {
  const sub = Object.assign(() => undefined, { pending: () => false });
  return { savedSessionSub: sub };
});
vi.mock("../terminal/staleness", () => ({
  useStaleCheck: () => () => false,
  formatTimeAgo: () => "",
}));
vi.mock("../ui/shown", () => ({ useShown: () => () => true }));
vi.mock("./useTileTheme", () => ({ useTileTheme: () => (id: string) => id }));
vi.mock("./useTileAura", () => ({ useTileAura: () => () => undefined }));
vi.mock("./useCanvasFocus", () => ({
  useCanvasFocus: () => ({ request: () => null, clear: () => {} }),
}));
vi.mock(import("./useViewPosture"), async (importOriginal) => ({
  ...(await importOriginal()),
  useViewPosture: () => ({
    layout: () => "tiled" as const,
    canMaximize: () => true,
    postureTo: () => {},
    toggle: () => {},
  }),
}));

import TerminalCanvas from "./TerminalCanvas";

/** Past `WIDE_SCOPE_DEPS`' 250 budget by a margin, so the finding is not a
 *  coin toss on a tile or two the canvas does or does not fold. */
const TILE_COUNT = 300;

let observers: { notify: ResizeObserverCallback; targets: Element[] }[] = [];
beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly own: { notify: ResizeObserverCallback; targets: Element[] };
      constructor(callback: ResizeObserverCallback) {
        this.own = { notify: callback, targets: [] };
        observers.push(this.own);
      }
      observe(target: Element) {
        this.own.targets.push(target);
      }
      unobserve(target: Element) {
        this.own.targets = this.own.targets.filter((el) => el !== target);
      }
      disconnect() {
        this.own.targets = [];
      }
    },
  );
});

function measure(): void {
  for (const { notify, targets } of observers)
    notify(
      targets.map(
        (target) =>
          ({
            target,
            contentRect: { width: 1200, height: 800 },
          }) as ResizeObserverEntry,
      ),
      undefined as unknown as ResizeObserver,
    );
  flush();
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
});

it("names the centring effect in its own finding", () => {
  const ids = Array.from({ length: TILE_COUNT }, (_, i) => `tile-${i}`);
  tiles.ids = () => ids;
  content.of = () => undefined;
  // ONE SIGNAL PER TILE, which is what a session restore hands the canvas: a
  // board of independently written layouts.
  const layouts = new Map<string, Accessor<TileLayout>>();
  ids.forEach((id, i) => {
    const [layout] = createSignal<TileLayout>({
      x: i * 10,
      y: i * 10,
      w: 300,
      h: 200,
    });
    layouts.set(id, layout);
  });
  // The ACTIVE tile's layout, as a caller that cannot answer for one tile
  // without reading the whole board gives it. The canvas resolves exactly
  // this tile inside the centring effect, so the effect's scope is the one
  // that goes wide.
  const wholeBoard = (): TileLayout => {
    let answer: TileLayout | undefined;
    for (const [id, read] of layouts) {
      const one = read();
      if (id === ACTIVE_TILE) answer = one;
    }
    return answer as TileLayout;
  };

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={ids}
        getLayout={(id: string) =>
          id === ACTIVE_TILE ? wholeBoard() : layouts.get(id)?.()
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
  // The viewport has to be MEASURED before the centring effect does anything:
  // its first line drops the impulse while `mounted()` is false.
  measure();

  const wide = takeSolidDiagnostics().filter(
    (event) => event.code === "WIDE_SCOPE_DEPS",
  );
  // The effect ran and crossed the budget — otherwise this file judges nothing.
  expect(wide.length).toBeGreaterThan(0);
  // …and every one of them is addressable: a bare `effect` is the collision
  // this naming exists to prevent.
  expect(wide.map((event) => event.nodeName)).toContain("centerOnFirstMount");
  expect(wide.map((event) => event.nodeName)).not.toContain("effect");
});
