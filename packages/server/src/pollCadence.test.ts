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
import { captureLatest, everyMsOrOnState } from "./pollCadence.ts";

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

describe("captureLatest — the synchronous liveness snapshot for the deferred poll read", () => {
  /** A fake session whose `onState` fires synchronously on subscribe + on each `poke`,
   *  and whose `currentClient()` liveness is a plain flip — enough to model
   *  `surface-remote`'s launchAttempt ordering without a real session. */
  function fakeSession() {
    let clientLive = false;
    let cb: (() => void) | undefined;
    return {
      onState: (onChange: () => void) => {
        cb = onChange;
        onChange(); // onState fires synchronously on subscribe (seeds the snapshot)
        return () => {
          cb = undefined;
        };
      },
      currentClient: () => clientLive,
      setClientLive: (v: boolean) => {
        clientLive = v;
      },
      poke: () => cb?.(),
    };
  }

  it("a reconnect-start onState snapshots the PRE-assignment liveness, so a later deferred read sees `absent` not the stale mirror (codex F1 regression)", () => {
    // Mimic surface-remote's launchAttempt: `attempt()` fires onState('connecting')
    // SYNCHRONOUSLY (setUp runs before the first await), and only AFTER that callback
    // returns does `clientPromise = attempt()` flip currentClient() truthy. The reactor
    // defers the poll read a microtask, so a read gated on a LIVE currentClient() would
    // observe the just-assigned promise and republish the primed mirror's stale RSS.
    const s = fakeSession();
    const liveness = captureLatest(
      (onChange) => s.onState(onChange),
      () => s.currentClient(),
    );
    // Boot / after a drop: padi is not live.
    expect(liveness()).toBe(false);

    // Reconnect attempt starts: onState('connecting') fires while the client is STILL not
    // live (pre-assignment) — the snapshot captures `false` at this instant.
    s.poke();
    // …then launchAttempt's `clientPromise = attempt()` lands: currentClient() flips truthy.
    s.setClientLive(true);

    // The DEFERRED read (a microtask later) consults the snapshot, not the live accessor:
    // it stays `false` → the cell reports `absent`, never the stale mirror during connecting.
    expect(liveness()).toBe(false);
    // Control: the pre-fix gate (a live read) would now be truthy → the stale-read regression.
    expect(s.currentClient()).toBe(true);
  });

  it("tracks the liveness accessor at each state change (connect → drop)", () => {
    const s = fakeSession();
    const liveness = captureLatest(
      (onChange) => s.onState(onChange),
      () => s.currentClient(),
    );
    expect(liveness()).toBe(false);

    // A genuine connect: the client is assigned, THEN onState('connected') fires.
    s.setClientLive(true);
    s.poke();
    expect(liveness()).toBe(true);

    // A later transition to a down (no-live-client) state re-snapshots `false`.
    s.setClientLive(false);
    s.poke();
    expect(liveness()).toBe(false);
  });
});
