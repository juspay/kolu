// @vitest-environment happy-dom

/** LOSING THE ENTRANCE MID-FLIGHT MUST NOT TEAR THE TILE'S CHROME.
 *
 *  The one-shot `landing` cue is armed on mount and SPENT by whatever cancels
 *  the entrance animation — maximizing the tile, putting it to sleep, a
 *  reduced-motion switch. The tile's own chrome spread reads `landing()` beside
 *  `props.mode` and `props.sleeping` (`data-landing`), which are the very props
 *  that cancel it: an inline spend from the watching effect's apply arm relays
 *  the cancel back into a render effect that has already run for it —
 *  `EFFECT_RELAY_TEAR`, reaching `warn` on the third tile lost mid-entrance.
 *
 *  The spend is settled now, so it carries no effect origin and lands in a
 *  later pass of the SAME flush. Three rounds, each a freshly mounted tile
 *  (the cue is armed once per shell), lose the entrance a different way; each
 *  asserts the tile's landing/animation attributes and an empty diagnostics
 *  drain — info `EFFECT_RELAY_TEAR` included, so the tear fails at its first
 *  sighting. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../dnd", () => ({
  createDraggable: () => ({
    ref: () => undefined,
    handleRef: () => undefined,
    transform: () => ({ x: 0, y: 0 }),
  }),
}));

// Motion is OBSERVABLE here: a reduced-motion tile never arms the entrance at
// all, so it has no cue to lose.
vi.mock("./viewport/animatedPan", () => ({
  prefersReducedMotion: () => false,
}));

import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import CanvasTile, { type CanvasTileMode } from "./CanvasTile";

const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `${e.severity} ${e.code} ${e.message}`);

describe("a canvas tile that loses its entrance mid-flight", () => {
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

  it("spends the cue on three tiles without tearing the tile chrome", () => {
    // Each round is a fresh shell, because the entrance arms once per mount.
    const rounds: { lose: "maximize" | "sleep"; label: string }[] = [
      { lose: "maximize", label: "maximized mid-entrance" },
      { lose: "sleep", label: "slept mid-entrance" },
      { lose: "maximize", label: "maximized mid-entrance again" },
    ];

    for (const round of rounds) {
      const [mode, setMode] = createSignal<CanvasTileMode>("tiled");
      const [sleeping, setSleeping] = createSignal(false);
      dispose = render(
        () => (
          <CanvasTile
            id="tile"
            active={false}
            mode={mode()}
            sleeping={sleeping()}
            theme={{ bg: "black", fg: "white" }}
            repoColor="white"
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

      const tile = host.querySelector("[data-testid=canvas-tile]");
      // THE ENTRANCE IS RUNNING: the cue armed on the mount's settle.
      expect(tile?.getAttribute("data-landing")).toBe("");
      expect(tile?.getAttribute("data-maximized")).toBeNull();
      expect(tile?.getAttribute("data-sleeping")).toBeNull();
      expect(drained()).toEqual([]);

      // THE GESTURE: eligibility is lost while the entrance is in flight.
      if (round.lose === "maximize") setMode("maximized");
      else setSleeping(true);
      flush();

      expect(tile?.getAttribute("data-landing")).toBeNull(); // spent
      expect(tile?.getAttribute("data-maximized")).toBe(
        round.lose === "maximize" ? "true" : null,
      );
      expect(tile?.getAttribute("data-sleeping")).toBe(
        round.lose === "sleep" ? "" : null,
      );
      expect(drained(), round.label).toEqual([]);

      // Coming back does NOT re-play the entrance: the cue is one-shot.
      if (round.lose === "maximize") setMode("tiled");
      else setSleeping(false);
      flush();
      expect(tile?.getAttribute("data-landing")).toBeNull();
      expect(drained(), round.label).toEqual([]);

      dispose();
      dispose = undefined;
      host.replaceChildren();
    }
  });
});
