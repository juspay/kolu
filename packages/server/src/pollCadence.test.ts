/**
 * The force-resample pin for kolu-server's derived poll cells (SR8.a done-criterion:
 * "prove the onState force-resample fires through the poll cell"). `everyMsOrOnState`
 * is the `install` those cells hand the reactor; this proves the bound-padi change-
 * signal (`padiSession.onState`) fires the SAME `tick` the reactor drives its re-read
 * with — so a padi drop/rebind force-resamples at once instead of waiting up to a full
 * interval (#1831's stale-MB regression). Composed with the reactor's own guarantee
 * that a tick re-reads (`@kolu/surface`'s `reactor.test.ts`), the resample provably
 * reaches the cell.
 *
 * Deterministic: fake timers for the interval, a hand-driven subscribe for the
 * change-signal — no real 5s/10s wait, no real padi.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyMsOrOnState } from "./pollCadence.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("everyMsOrOnState — the fused interval + onState force-resample", () => {
  it("fires the tick when the subscribed change-signal fires (the force-resample), not just on the interval", () => {
    let fireStateChange!: () => void;
    const subscribe = (tick: () => void): (() => void) => {
      fireStateChange = tick;
      return () => {};
    };
    const tick = vi.fn();

    const cleanup = everyMsOrOnState(5_000, subscribe)(tick);

    // No interval elapsed yet — but a padi state change force-resamples immediately.
    expect(tick).not.toHaveBeenCalled();
    fireStateChange();
    expect(tick).toHaveBeenCalledTimes(1);

    // The interval still ticks independently.
    vi.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
    fireStateChange();
    expect(tick).toHaveBeenCalledTimes(3);

    cleanup();
  });

  it("the interval is unref'd so a live sampler never holds the process open on its own", () => {
    const unref = vi.fn();
    const setInterval = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref } as unknown as ReturnType<
        typeof globalThis.setInterval
      >);

    const cleanup = everyMsOrOnState(5_000, () => () => {})(() => {});
    expect(setInterval).toHaveBeenCalledOnce();
    expect(unref).toHaveBeenCalledOnce();

    cleanup();
    setInterval.mockRestore();
  });

  it("cleanup unsubscribes the change-signal AND clears the interval — both, not one", () => {
    const off = vi.fn();
    const subscribe = vi.fn((_tick: () => void) => off);
    const tick = vi.fn();

    const cleanup = everyMsOrOnState(5_000, subscribe)(tick);
    expect(subscribe).toHaveBeenCalledOnce();

    cleanup();
    // The subscription is torn down …
    expect(off).toHaveBeenCalledOnce();
    // … and the interval no longer fires the tick.
    vi.advanceTimersByTime(20_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
