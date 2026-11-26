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
import { afterEach, expect, it, vi } from "vitest";
import type { TileContent } from "../tile/tileContent";

const content = vi.hoisted(() => ({
  of: (() => undefined) as (id: string) => TileContent | undefined,
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
vi.mock("./useTileTheme", () => ({ useTileTheme: () => (id: string) => id }));
vi.mock("./useTileAura", () => ({ useTileAura: () => () => undefined }));
vi.mock("./useCanvasFocus", () => ({
  useCanvasFocus: () => ({ request: () => null, clear: () => {} }),
}));
vi.mock("./useViewPosture", () => ({
  useViewPosture: () => ({ layout: () => "tiled", toggle: () => {} }),
}));
vi.mock("./dock/Dock", () => ({ default: () => null }));
vi.mock("./CanvasMinimap", () => ({ default: () => null }));
vi.mock("./CanvasTile", () => ({
  default: (props: { id: string; theme: string }) => (
    <div data-testid="tile" data-id={props.id} data-theme={props.theme} />
  ),
}));

import TerminalCanvas from "./TerminalCanvas";

const TILE = "tile-1";
const ONE = "one" as TerminalId;

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("mounts the desktop canvas with no location-less strict read", () => {
  content.of = (id) =>
    id === TILE ? { kind: "terminal", terminalId: ONE } : undefined;

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
  flush();

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
