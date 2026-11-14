import { createComputed, createRoot, createSignal, on } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasTileMode } from "./CanvasTile";
import {
  createHeldSeen,
  SEEN_HOLD_MS,
  type TileSeenFacts,
  tileIsSeen,
} from "./tileSeen";

const facts = (over: Partial<TileSeenFacts> = {}): TileSeenFacts => ({
  viewShown: true,
  cameraSettled: true,
  mode: "tiled" as CanvasTileMode,
  active: false,
  onScreen: true,
  ...over,
});

describe("tileIsSeen", () => {
  it("sees the maximized tile", () => {
    // It fills the viewport, so its own rect against the camera says nothing.
    expect(tileIsSeen(facts({ mode: "maximized", onScreen: false }))).toBe(
      true,
    );
  });

  it("sees a tiled tile whose rect is in view", () => {
    expect(tileIsSeen(facts({ onScreen: true }))).toBe(true);
  });

  it("sees the active tile the user has panned away from", () => {
    // The keyboard still reaches it, so its output must keep arriving.
    expect(tileIsSeen(facts({ onScreen: false, active: true }))).toBe(true);
  });

  it("does not see a tile panned out of view", () => {
    expect(tileIsSeen(facts({ onScreen: false }))).toBe(false);
  });

  it("does not see a tile behind the maximized one", () => {
    expect(tileIsSeen(facts({ mode: "covered", onScreen: true }))).toBe(false);
  });

  it("sees nothing while the Conductor covers the canvas", () => {
    for (const over of [
      { mode: "maximized" as CanvasTileMode },
      { onScreen: true },
      { active: true, onScreen: false },
    ]) {
      expect(tileIsSeen(facts({ ...over, viewShown: false }))).toBe(false);
    }
  });

  it("sees nothing while the camera is still flying somewhere", () => {
    // A host switch or a restored session pans the camera; what it sweeps
    // over on the way is not what the user asked to look at.
    for (const over of [
      { mode: "maximized" as CanvasTileMode },
      { onScreen: true },
      { active: true, onScreen: false },
    ]) {
      expect(tileIsSeen(facts({ ...over, cameraSettled: false }))).toBe(false);
    }
  });
});

describe("createHeldSeen", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
  });

  /** Drive the hold over a signal, returning both ends — plus how many times
   *  the held answer actually CHANGED, which is what a pane acts on. */
  function harness(initial: boolean) {
    return createRoot((d) => {
      dispose = d;
      const [seen, setSeen] = createSignal(initial);
      const held = createHeldSeen(seen);
      let changes = 0;
      createComputed(
        on(
          held,
          () => {
            changes += 1;
          },
          { defer: true },
        ),
      );
      return { held, setSeen, changes: () => changes };
    });
  }

  it("attaches the moment a tile is seen", () => {
    const { held, setSeen } = harness(false);
    expect(held()).toBe(false);
    setSeen(true);
    expect(held()).toBe(true);
  });

  it("holds a tile that leaves the view, then lets go once", () => {
    const { held, setSeen, changes } = harness(true);
    setSeen(false);
    expect(held()).toBe(true);
    vi.advanceTimersByTime(SEEN_HOLD_MS - 1);
    expect(held()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(held()).toBe(false);
    expect(changes()).toBe(1);
  });

  it("changes nothing when the tile is seen again inside the hold", () => {
    const { held, setSeen, changes } = harness(true);
    setSeen(false);
    vi.advanceTimersByTime(SEEN_HOLD_MS - 1);
    setSeen(true);
    expect(held()).toBe(true);
    // The pending let-go was spent, not merely outvoted.
    vi.advanceTimersByTime(SEEN_HOLD_MS * 2);
    expect(held()).toBe(true);
    // No detach, no re-attach: the pane was never told anything.
    expect(changes()).toBe(0);
  });

  it("gives a never-seen tile no hold at all", () => {
    const { held, setSeen } = harness(false);
    setSeen(false);
    vi.advanceTimersByTime(SEEN_HOLD_MS * 2);
    expect(held()).toBe(false);
  });

  it("restarts the hold on each departure, not each leaving frame", () => {
    const { held, setSeen } = harness(true);
    setSeen(false);
    vi.advanceTimersByTime(SEEN_HOLD_MS - 1);
    setSeen(true);
    setSeen(false);
    // A fresh departure gets a fresh window.
    vi.advanceTimersByTime(SEEN_HOLD_MS - 1);
    expect(held()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(held()).toBe(false);
  });

  it("drops its timer with the tile", () => {
    const { held, setSeen } = harness(true);
    setSeen(false);
    dispose?.();
    dispose = undefined;
    vi.advanceTimersByTime(SEEN_HOLD_MS * 2);
    // Disposed owner: the pending flip was cancelled, not applied late.
    expect(held()).toBe(true);
  });
});
