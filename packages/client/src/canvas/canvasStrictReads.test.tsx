// @vitest-environment happy-dom
/**
 * THE PROBE FOR A FINDING WITH NO NAME.
 *
 * The Solid-diagnostics e2e lane reports a `STRICT_READ_UNTRACKED` carrying
 * neither `loc` nor `ownerPath`: an effect APPLY arm reading a signal or memo
 * that has no name either, which `emitDiagnostic` cannot place because an
 * apply arm enters no owner (`@solidjs/signals` 2.0.4 `dev.js:1586-1654`,
 * `dev-shared.js:853-871`). The harness now carries the stack captured inside
 * the subscriber, and this file is the local half of the same instrument: it
 * mounts the DESKTOP CANVAS with its three reactive helpers REAL —
 * `usePendingLayouts`, `useCanvasViewport` and `useCanvasCenterOnSwitch`,
 * which every other canvas test stubs out — and fails naming the stack of any
 * location-less strict read it provokes.
 *
 * The stores around the canvas are stubbed exactly as
 * `TerminalCanvas.tileContent.test.tsx` stubs them: this is a probe of the
 * canvas's own reactive wiring, not of the stores it reads.
 */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileContent } from "../tile/tileContent";

const content = vi.hoisted(() => ({
  of: (() => undefined) as (id: string) => TileContent | undefined,
}));
const tiles = vi.hoisted(() => ({ ids: (() => []) as () => string[] }));
// THE TWO FACTS THE CANVAS RE-RENDERS ON, as signals rather than constants:
// a probe that only mounts never runs an apply arm a second time, and the
// finding this file hunts lives in the arms that re-run.
const [activeTile, setActiveTile] = createSignal<string | null>(null);
const [tileLayout, setTileLayout] = createSignal({
  x: 0,
  y: 0,
  w: 300,
  h: 200,
});

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({
    contentOf: (id: string) => content.of(id),
    isActiveTile: (id: string) => activeTile() === id,
    isFocused: (id: string) => activeTile() === id,
    activeId: () => activeTile(),
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
    forgetFromMru: () => {},
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

const TILE = "tile-1";
const ONE = "one" as TerminalId;

// THE VIEWPORT'S MEASUREMENT. `mounted()` — the minimap's gate — is
// `observedSize() !== undefined`, and happy-dom delivers no resize entries, so
// without this the minimap never renders and the probe never reaches its
// reads. The observed elements are recorded here and `measure()` delivers one
// desktop-sized entry for each, from OUTSIDE the graph, which is where a real
// observer's delivery comes from.
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

it("mounts the desktop canvas with no location-less strict read", () => {
  tiles.ids = () => [TILE];
  content.of = (id) =>
    id === TILE ? { kind: "terminal", terminalId: ONE } : undefined;

  const host = document.createElement("div");
  dispose = render(
    () => (
      <TerminalCanvas
        tileIds={[TILE]}
        getLayout={() => tileLayout()}
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
  measure();

  // THE REAL TREES ARE IN THE DOM. A canvas whose tile, dock and minimap
  // never rendered would report "clean" for a reason that has nothing to do
  // with its reads, so each one's own element is named here.
  expect(host.querySelector("[data-testid='canvas-tile']")).toBeTruthy();
  expect(host.querySelector("[data-testid='dock']")).toBeTruthy();
  expect(host.querySelector("[data-testid='canvas-minimap']")).toBeTruthy();

  // A SECOND PUBLISH of each fact the canvas re-renders on, so the per-tile
  // and per-row apply arms run again rather than only at mount: the active
  // tile (dock row paint, tile chrome, maximize mode) and the tile's layout
  // (transform, minimap rect).
  setActiveTile(TILE);
  flush();
  setTileLayout({ x: 120, y: 80, w: 420, h: 260 });
  flush();
  measure();

  // TAKEN, so this assertion is what judges them: a finding with no location
  // and no owner is the one the lane cannot name, and its stack — captured
  // where Solid raised it — is the name.
  const nameless = takeSolidDiagnostics().filter(
    (event) =>
      event.code === "STRICT_READ_UNTRACKED" &&
      event.loc === undefined &&
      event.ownerPath === undefined,
  );
  expect(
    nameless.map(
      (event) => `${event.nodeName ?? "(unnamed)"}: ${event.message}`,
    ),
  ).toEqual([]);
});

// THE PROBE'S OWN SENSITIVITY. The finding this file hunts is a specific
// shape — an apply arm reading a value with no name — and a probe that cannot
// raise it would report "clean" forever. So raise one on purpose, and hold
// the shape the lane sees: no `loc`, no `ownerPath`, and a `nodeName` that is
// the constructor's default, which is why the message names nothing.
it("would catch a location-less strict read if the canvas raised one", () => {
  const held = createRoot((disposeRoot) => {
    // NOT bound to a declarator, so `@solidjs/compiler` gives it no name —
    // the same shape as a memo returned straight out of a helper.
    const unnamed = (() => createSignal(0))();
    const [source, setSource] = createSignal(0);
    createEffect(
      () => source(),
      () => {
        // The apply arm: a strict-read scope that enters no owner, so Solid
        // can place this read neither by location nor by owner.
        unnamed[0]();
      },
    );
    return { bump: () => setSource(1), disposeRoot };
  });
  flush();
  held.bump();
  flush();
  held.disposeRoot();

  const nameless = takeSolidDiagnostics().filter(
    (event) =>
      event.code === "STRICT_READ_UNTRACKED" &&
      event.loc === undefined &&
      event.ownerPath === undefined,
  );
  expect(nameless.length).toBeGreaterThan(0);
  expect(nameless[0]?.nodeName).toBe("signal");
});
