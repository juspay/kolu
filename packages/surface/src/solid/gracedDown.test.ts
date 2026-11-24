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
 * `flush()` after a write is where a real consumer observes it: writes are STAGED
 * until the flush, and an effect's first run — and every later one — happens
 * there, not on the write itself. So the window is armed (or cleared) only once
 * the flush has run, and the timer the fake clock then advances exists only
 * because of it. The same goes the other way: `setShown` fires inside the timer
 * callback, so its value is readable after the next flush.
 */

import { type Accessor, createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gracedDown } from "./gracedDown";

const GRACE_MS = 1_000;

describe("gracedDown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("swallows a sub-window blink — source true then false inside the grace never shows", () => {
    const [down, setDown] = createSignal(false);
    const { shown, dispose } = createRoot((dispose) => {
      const shown: Accessor<boolean> = gracedDown(down, GRACE_MS);
      return { shown, dispose };
    });
    flush(); // the effect's first run — the window is not armed, source is false
    expect(shown()).toBe(false);

    // Rises, but falls again well within the window — the overlay never armed.
    setDown(true);
    flush();
    vi.advanceTimersByTime(300);
    setDown(false);
    flush();
    expect(shown()).toBe(false);

    // The cancelled show-timer can't fire even after the window fully elapses.
    vi.advanceTimersByTime(GRACE_MS * 5);
    flush();
    expect(shown()).toBe(false);
    dispose();
  });

  it("shows a sustained true once the window elapses, and hides instantly on the fall", () => {
    const [down, setDown] = createSignal(false);
    const { shown, dispose } = createRoot((dispose) => {
      const shown = gracedDown(down, GRACE_MS);
      return { shown, dispose };
    });
    flush();

    setDown(true);
    flush(); // the rising edge arms the window on this write's flush
    // Just before the window closes: still held back.
    vi.advanceTimersByTime(GRACE_MS - 1);
    flush();
    expect(shown()).toBe(false);
    // Past it: a genuine sustained `true` surfaces.
    vi.advanceTimersByTime(1);
    flush(); // the timer's `setShown(true)` is readable from here
    expect(shown()).toBe(true);
    // The fall hides it instantly — no second grace window on the way down.
    setDown(false);
    flush();
    expect(shown()).toBe(false);
    dispose();
  });

  it("does not reset a pending window when source re-fires true while already down", () => {
    // A `source` that re-emits `true` (a new value each tick) without ever
    // dropping must not keep pushing the window out — the grace measures
    // CONTINUOUS truth from the first rise, not from the latest re-emit.
    const [tick, setTick] = createSignal(0);
    const { shown, dispose } = createRoot((dispose) => {
      const shown = gracedDown(() => tick() >= 0, GRACE_MS);
      return { shown, dispose };
    });
    flush(); // source is already true → the window arms now

    vi.advanceTimersByTime(GRACE_MS - 100);
    setTick(1); // still true, re-emitted — must NOT re-arm the timer
    flush();
    vi.advanceTimersByTime(100);
    flush();
    expect(shown()).toBe(true);
    dispose();
  });

  it("clears the pending timer on dispose — a late fire can't show after teardown", () => {
    const [down, setDown] = createSignal(false);
    const { shown, dispose } = createRoot((dispose) => {
      const shown = gracedDown(down, GRACE_MS);
      return { shown, dispose };
    });
    flush();
    setDown(true);
    flush(); // the window is genuinely armed before the teardown below
    dispose(); // tear down before it elapses → onCleanup clears the timer
    vi.advanceTimersByTime(GRACE_MS * 5);
    flush();
    expect(shown()).toBe(false);
  });
});
