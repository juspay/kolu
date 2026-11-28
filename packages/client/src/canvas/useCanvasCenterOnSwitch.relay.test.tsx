// @vitest-environment happy-dom
/** THE SWITCH EPOCH MUST NOT RELAY THE SWITCH BACK INTO THE CENTRING COMPUTE.
 *
 *  The centring resolver asks one question per host switch: does the incoming
 *  host's active tile need the camera put on it? Its compute reads the switch
 *  epoch AND, on any run that gets past the guards, the host's scope, the
 *  active tile id and that tile's layout — all of which move on the very write
 *  the epoch is counting.
 *
 *  So from the SECOND switch on the compute ran twice for one gesture: once for
 *  `activeHost` itself (epoch still the served one — verdict `null`, deps
 *  narrowing again), then once more for the epoch an effect's apply arm had
 *  just bumped. Both runs trace to the same root write, and the second one's
 *  only cause is an effect's write: `EFFECT_RELAY_TEAR`, `warn` on the third
 *  switch.
 *
 *  The epoch is DERIVED from `activeHost` now, so the switch is one pass and
 *  the verdict is the same one master reached. This test switches three times
 *  through the three cases master distinguishes — an unpositioned host (seed),
 *  a retained pose that still shows its active tile (no-op), a retained pose
 *  the tile has drifted out of (re-centre) — and asserts the camera's pose
 *  after each, plus an empty diagnostics drain. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createCamera, type HostCamera } from "../hostScope/createCamera";
import type { TileLayout } from "./TileLayout";
import { computeCenterPan } from "./viewport/transforms";

const VIEWPORT = { width: 1200, height: 800 };

/** Each host's one tile, by tile id. */
const LAYOUTS: Record<string, TileLayout> = {
  "tile-a": { x: 0, y: 0, w: 400, h: 300 },
  "tile-b": { x: 5000, y: 4000, w: 400, h: 300 },
  "tile-c": { x: 200, y: 150, w: 400, h: 300 },
  "tile-d": { x: 9000, y: 9000, w: 400, h: 300 },
};

const wire = vi.hoisted(() => ({
  activeHost: (() => "host-a") as () => string,
  switchTo: (_key: string) => {},
}));
const tiles = vi.hoisted(() => ({
  activeId: (() => "tile-a") as () => string,
  activate: (_id: string) => {},
  /** Every impulse the hook fired, in order. */
  centred: [] as string[],
  /** The ones whose pan has not landed yet (production lands it in a rAF). */
  pending: [] as string[],
}));
// Built per test and cleared after, so a Map rather than a literal table.
const cameras = new Map<string, HostCamera>();

vi.mock("../wire", async () => {
  // A mock factory is hoisted above the imports, so the module it needs can
  // only be reached dynamically.
  const { createSignal } = await import("solid-js");
  const [host, setHost] = createSignal("host-a");
  wire.activeHost = host;
  wire.switchTo = setHost;
  return { activeHost: host };
});
// The real shape: one scope per host, re-keyed by `activeHost` — so the
// centring compute's `activeScope()` leg moves on the switch write itself.
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({ camera: cameras.get(wire.activeHost()) }),
}));
vi.mock("../terminal/useTerminalStore", async () => {
  const { createSignal } = await import("solid-js");
  const [activeId, setActiveId] = createSignal("tile-a");
  tiles.activeId = activeId;
  tiles.activate = setActiveId;
  return {
    useTerminalStore: () => ({
      activeId,
      // The impulse itself writes nothing but the request: production's pan
      // lands a frame later, in `TerminalCanvas.centerOnFocusRequest`'s
      // `requestAnimationFrame(() => viewport.centerOnTile(layout))`.
      requestCenterActive: (id: string) => {
        tiles.centred.push(id);
        tiles.pending.push(id);
      },
    }),
  };
});
vi.mock("./viewport/useCanvasViewport", () => ({
  useCanvasViewport: () => ({
    mounted: () => true,
    viewportSize: () => VIEWPORT,
    abortTransientInput: () => {},
  }),
}));

// Imported after the mocks so the hook's module graph is built against them —
// a static import would be hoisted ahead of them.
const { useCanvasCenterOnSwitch } = await import("./useCanvasCenterOnSwitch");

const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `${e.severity} ${e.code} ${e.message}`);

/** The pose a centre-on-tile impulse puts the camera at. */
function centredOn(id: string, zoom = 1): { panX: number; panY: number } {
  const tile = LAYOUTS[id];
  if (!tile) throw new Error(`no layout for ${id}`);
  return computeCenterPan(
    tile.x,
    tile.y,
    tile.x + tile.w,
    tile.y + tile.h,
    VIEWPORT.width,
    VIEWPORT.height,
    zoom,
  );
}
function pose(host: string): { panX: number; panY: number } {
  const camera = cameras.get(host);
  if (!camera) throw new Error(`no camera for ${host}`);
  return { panX: camera.panX(), panY: camera.panY() };
}
/** The deferred half of the impulse: pan the host's camera onto the tile the
 *  request named, as the canvas's frame callback does. */
function landCentres(): void {
  for (const id of tiles.pending.splice(0)) {
    const camera = cameras.get(wire.activeHost());
    if (!camera || !LAYOUTS[id]) continue;
    const { panX, panY } = centredOn(id, camera.zoom());
    camera.setPanX(panX);
    camera.setPanY(panY);
  }
}

let dispose: (() => void) | undefined;
let disposeCameras: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  disposeCameras?.();
  disposeCameras = undefined;
  cameras.clear();
  tiles.centred.length = 0;
  tiles.pending.length = 0;
});

it("services three host switches without relaying the epoch", () => {
  disposeCameras = createRoot((d) => {
    for (const host of ["host-a", "host-b", "host-c", "host-d"])
      cameras.set(host, createCamera());
    return d;
  });
  // host-c arrives already positioned on its tile: a revisit that still shows
  // its active tile is master's no-op case.
  const hostC = cameras.get("host-c");
  const cPose = centredOn("tile-c");
  hostC?.setPanX(cPose.panX);
  hostC?.setPanY(cPose.panY);
  // host-d is positioned too, but its active tile has drifted far out of the
  // retained view — master re-centres this one.
  const hostD = cameras.get("host-d");
  hostD?.setPanX(0);
  hostD?.setPanY(0);

  wire.switchTo("host-a");
  tiles.activate("tile-a");
  dispose = createRoot((d) => {
    const layout = createMemo(() => LAYOUTS[tiles.activeId()], {
      name: "testActiveTileLayout",
    });
    useCanvasCenterOnSwitch(layout);
    return d;
  });
  flush();
  expect(tiles.centred).toEqual([]); // mount is not a switch
  expect(pose("host-a")).toEqual({ panX: 0, panY: 0 });
  expect(drained()).toEqual([]);

  // Switch 1 — host-b has never been positioned: seed on its active tile.
  wire.switchTo("host-b");
  tiles.activate("tile-b");
  flush();
  landCentres();
  flush();
  expect(tiles.centred).toEqual(["tile-b"]);
  expect(pose("host-b")).toEqual(centredOn("tile-b"));
  expect(pose("host-a")).toEqual({ panX: 0, panY: 0 }); // untouched
  expect(drained()).toEqual([]);

  // Switch 2 — host-c's retained pose still shows its active tile: no impulse,
  // and the pose stays exactly where the user left it.
  wire.switchTo("host-c");
  tiles.activate("tile-c");
  flush();
  landCentres();
  flush();
  expect(tiles.centred).toEqual(["tile-b"]);
  expect(pose("host-c")).toEqual(cPose);
  expect(drained()).toEqual([]);

  // Switch 3 — host-d is positioned but stale: re-centre.
  wire.switchTo("host-d");
  tiles.activate("tile-d");
  flush();
  landCentres();
  flush();
  expect(tiles.centred).toEqual(["tile-b", "tile-d"]);
  expect(pose("host-d")).toEqual(centredOn("tile-d"));
  expect(drained()).toEqual([]);
});
