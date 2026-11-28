// @vitest-environment happy-dom

/** THE FINISH-EXHALE ARMS WITHOUT TEARING THE TILE'S CHROME.
 *
 *  The one-shot `exhale` is decided by an effect watching the aura tier, and the tile's
 *  chrome spread (`CanvasTile.tsx`'s host `div`) READS it — so an inline write from that
 *  effect's apply arm relays into an already-run render effect: the dev lane reports it as
 *  `EFFECT_RELAY_TEAR` at `CanvasTile.tsx:408`, two scenarios from `warn`.
 *
 *  This drives the real tile through the transition that arms the exhale and asserts
 *  `takeSolidDiagnostics()` is EMPTY — info `EFFECT_RELAY_TEAR` included, so the tear fails
 *  at its FIRST sighting rather than at the third the dev lane needs — while the attribute
 *  the exhale exists for still lands. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../dnd", () => ({
  createDraggable: () => ({
    ref: () => undefined,
    handleRef: () => undefined,
    transform: () => ({ x: 0, y: 0 }),
  }),
}));

// Motion is OBSERVABLE here — the opposite of `CanvasTile.test.tsx`'s stub, because a
// reduced-motion tile never arms the exhale at all and so has no relay to grade.
vi.mock("./viewport/animatedPan", () => ({
  prefersReducedMotion: () => false,
}));

import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import CanvasTile from "./CanvasTile";
import type { TileAura } from "./tileAura";

describe("the canvas tile's finish-exhale", () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it("arms on the transition into finished with no tear in the tile chrome", () => {
    const [tier, setTier] = createSignal<TileAura>("working");
    dispose = render(
      () => (
        <CanvasTile
          id="tile"
          // Inactive: an ACTIVE tile mutes its own aura, so it never arms.
          active={false}
          mode="tiled"
          theme={{ bg: "black", fg: "white" }}
          repoColor="white"
          auraTier={tier}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onToggleMaximize={vi.fn()}
          renderTitle={() => <span>Tile</span>}
          renderBody={() => <div data-testid="body" />}
          getLayout={() => ({ x: 0, y: 0, w: 100, h: 100 })}
          startResize={vi.fn()}
          panX={() => 0}
          panY={() => 0}
          zoom={() => 1}
          viewportSize={() => ({ width: 500, height: 500 })}
          viewShown={() => true}
          cameraSettled={() => true}
        />
      ),
      host,
    );
    flush();
    // The mount's own frame is not what this pins.
    takeSolidDiagnostics();

    const tile = host.querySelector("[data-testid=canvas-tile]");
    expect(tile?.getAttribute("data-exhale")).toBeNull();

    // The turn finishes: the tier TRANSITION arms the one-shot.
    setTier("finished");
    flush();
    expect(takeSolidDiagnostics()).toEqual([]);
    expect(tile?.getAttribute("data-exhale")).toBe("");

    // Leaving finished spends it — the same effect, writing the other way.
    setTier("working");
    flush();
    expect(takeSolidDiagnostics()).toEqual([]);
    expect(tile?.getAttribute("data-exhale")).toBeNull();
  });
});
