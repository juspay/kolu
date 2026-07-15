/**
 * `captureLatest` — the synchronous liveness-snapshot pin (SR8.a codex F1 regression):
 * proves the snapshot is taken at the state-change instant, so a microtask-deferred poll
 * read sees the PRE-assignment liveness and never republishes a stale mirror during a
 * reconnect.
 *
 * (The `everyMsOrOnState` cadence-fuse tests retired in SR8.c: the fuse graduated into
 * `@kolu/surface`'s domain-free `everyMsOr(ms, subscribe)`, pinned there.)
 */

import { describe, expect, it } from "vitest";
import { captureLatest } from "./pollCadence.ts";

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
