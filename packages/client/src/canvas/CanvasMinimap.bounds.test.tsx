// @vitest-environment happy-dom
/**
 * THE MINIMAP'S BOUNDS RECOMPUTE ONCE PER ECHO.
 *
 * `bounds` walks every tile's layout, so it re-runs whenever one moves. A
 * drag's pending override used to be released BY A WRITE — an effect read the
 * pending store, saw the saved layout catch up and deleted the entry — so the
 * server's echo cost the minimap two passes over every tile: one for the echo
 * itself, one for the release that changed nothing. The override now carries
 * the saved layout it was minted against, so the echo releases it on arrival.
 *
 * The probe is the `getLayout` prop: `bounds` and each tile's geometry memo
 * read it, so its call count per flush IS the number of passes. The test
 * calibrates that count on a plain layout change (one pass by construction)
 * and demands the echo cost exactly the same.
 */

import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createEffect, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TileLayout } from "./TileLayout";

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: (id: string) => ({
      repoColor: "#123456",
      key: { group: id, label: id, suffix: "" },
    }),
    getMetadata: () => ({ lastActivityAt: 0 }),
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

import CanvasMinimap from "./CanvasMinimap";
import { usePendingLayouts } from "./usePendingLayouts";

const ID = "tile-1" as TerminalId;
const SAVED: TileLayout = { x: 0, y: 0, w: 300, h: 200 };
const MOVED: TileLayout = { x: 500, y: 400, w: 300, h: 200 };
const DRAGGED: TileLayout = { x: 900, y: 700, w: 300, h: 200 };

let dispose: (() => void) | undefined;
beforeEach(() => usePendingLayouts().clear());
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** The minimap over the canvas's layout resolution, with the canvas's
 *  dead-tile hygiene pass alongside it. */
function mountMinimap() {
  const pending = usePendingLayouts();
  const [saved, setSaved] = createSignal<TileLayout>(SAVED);
  let reads = 0;
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => {
    createEffect(
      () => pending.deadIds(new Set([ID])),
      (dead) => {
        pending.dropIds(dead);
      },
    );
    return (
      <CanvasMinimap
        shown={true}
        tileIds={[ID]}
        getLayout={(id) => {
          reads++;
          return pending.resolveLayout(id as TerminalId, saved());
        }}
        onSelect={() => {}}
        onStartTileDrag={() => null}
      />
    );
  }, host);
  flush();
  return {
    pending,
    saved,
    setSaved,
    passes: () => reads,
    sincePasses: (before: number) => reads - before,
  };
}

it("recomputes its bounds once when a drag's echo lands", () => {
  const map = mountMinimap();

  // Calibrate: a layout change with no override is one pass by construction.
  const beforePlain = map.passes();
  map.setSaved(MOVED);
  flush();
  const onePass = map.sincePasses(beforePlain);
  expect(onePass).toBeGreaterThan(0);

  // A drag holds its own layout until the server echoes it back.
  map.pending.setOne(ID, DRAGGED, map.saved());
  flush();

  const beforeEcho = map.passes();
  map.setSaved(DRAGGED); // the echo
  flush();

  expect(map.sincePasses(beforeEcho)).toBe(onePass);
});
