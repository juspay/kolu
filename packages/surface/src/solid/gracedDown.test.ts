/**
 * `gracedDown` — the grace-windowed boolean view. Covered here (not folded into a
 * transport's lifecycle suite) because the grace is a pure derivation over ANY
 * boolean accessor, independent of what `source` means. The surface package's
 * vitest aliases `solid-js` to its browser build, so the `createEffect` driving
 * the window is REAL under the node-default env (no DOM needed — signals + a fake
 * timer). These pin the two behaviours the overlay depends on: a sub-second blink
 * is swallowed, and a sustained `true` surfaces once the window elapses (then
 * hides instantly on the fall).
 *
 * `await Promise.resolve()` after the mount flushes Solid's initial effect run
 * (deferred to the end of `createRoot`'s batch); thereafter a top-level signal
 * write re-runs the effect synchronously, so the timer is armed before the fake
 * clock advances.
 */

import { type Accessor, createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gracedDown } from "./gracedDown";

const GRACE_MS = 1_000;

describe("gracedDown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("swallows a sub-window blink — source true then false inside the grace never shows", async () => {
    await createRoot(async (dispose) => {
      const [down, setDown] = createSignal(false);
      const shown: Accessor<boolean> = gracedDown(down, GRACE_MS);
      await Promise.resolve(); // flush the initial effect, leave createRoot's batch
      expect(shown()).toBe(false);

      // Rises, but falls again well within the window — the overlay never armed.
      setDown(true);
      vi.advanceTimersByTime(300);
      setDown(false);
      expect(shown()).toBe(false);

      // The cancelled show-timer can't fire even after the window fully elapses.
      vi.advanceTimersByTime(GRACE_MS * 5);
      expect(shown()).toBe(false);
      dispose();
    });
  });

  it("shows a sustained true once the window elapses, and hides instantly on the fall", async () => {
    await createRoot(async (dispose) => {
      const [down, setDown] = createSignal(false);
      const shown = gracedDown(down, GRACE_MS);
      await Promise.resolve();

      setDown(true);
      // Just before the window closes: still held back.
      vi.advanceTimersByTime(GRACE_MS - 1);
      expect(shown()).toBe(false);
      // Past it: a genuine sustained `true` surfaces.
      vi.advanceTimersByTime(1);
      expect(shown()).toBe(true);
      // The fall hides it instantly — no second grace window on the way down.
      setDown(false);
      expect(shown()).toBe(false);
      dispose();
    });
  });

  it("does not reset a pending window when source re-fires true while already down", async () => {
    await createRoot(async (dispose) => {
      // A `source` that re-emits `true` (a new value each tick) without ever
      // dropping must not keep pushing the window out — the grace measures
      // CONTINUOUS truth from the first rise, not from the latest re-emit.
      const [tick, setTick] = createSignal(0);
      const shown = gracedDown(() => tick() >= 0, GRACE_MS);
      await Promise.resolve(); // source is already true → the window arms now

      vi.advanceTimersByTime(GRACE_MS - 100);
      setTick(1); // still true, re-emitted — must NOT re-arm the timer
      vi.advanceTimersByTime(100);
      expect(shown()).toBe(true);
      dispose();
    });
  });

  it("clears the pending timer on dispose — a late fire can't show after teardown", async () => {
    let shown!: Accessor<boolean>;
    await createRoot(async (dispose) => {
      const [down, setDown] = createSignal(false);
      shown = gracedDown(down, GRACE_MS);
      await Promise.resolve();
      setDown(true); // arm the window
      dispose(); // tear down before it elapses → onCleanup clears the timer
    });
    vi.advanceTimersByTime(GRACE_MS * 5);
    expect(shown()).toBe(false);
  });
});
