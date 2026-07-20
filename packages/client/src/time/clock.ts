/** Shared app-wide ticking clocks. One owned interval per (source, cadence), via
 *  the `createSharedRoot` singleton idiom (the same one `staleness.ts`'s
 *  `getNowTicker` and `useDockOrder` use), so every readout at a given cadence
 *  subscribes to ONE live `now` signal instead of spinning a timer apiece. */

import { type Accessor, createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

/** THE ticking-clock machinery — the receptacle for "one shared app-lifetime
 *  reactive tick over a time source". The volatile axis is the (source, cadence)
 *  pair, so it is parameterized here ONCE rather than hand-copied per clock: a fix
 *  to the tick machinery (throttling, visibility handling, teardown) lands in a
 *  single place.
 *
 *  App-lifetime by `createSharedRoot`'s contract: the interval is the app's one
 *  clock at this cadence and ticks for the whole session — there is no teardown
 *  (the shared root's disposer is intentionally discarded), so we do NOT register
 *  an `onCleanup` that would never run. The browser reclaims the timer on page
 *  close. Reading the returned accessor in a tracking context (JSX/memo) re-renders
 *  that consumer each tick; a hidden tab throttles the interval on its own. */
export const makeTickingClock = (
  read: () => number,
  intervalMs = 1_000,
): (() => Accessor<number>) =>
  createSharedRoot<Accessor<number>>(() => {
    const [now, setNow] = createSignal(read());
    setInterval(() => setNow(read()), intervalMs);
    return now;
  });

/** `Date.now()` that advances every second. Drives the second-granularity live
 *  readouts — the chrome-bar kaval uptime and the inspector's "Running for" — off a
 *  single shared interval.
 *
 *  Distinct from `staleness.ts`'s 60s `getNowTicker`: staleness is hours-scale,
 *  where a 60s visual lag is invisible and a per-second wake would be waste — so the
 *  two cadences stay separate, each owning the readouts it fits. */
export const getClockNow = makeTickingClock(Date.now);

/** `performance.now()` that advances every second via ONE shared interval — the
 *  reactivity TICK (so a boot overlay's elapsed re-evaluates each second), while the
 *  VALUE is MONOTONIC so a wall-clock step can't false-fire the #1763 boot ceiling.
 *  Same shared-interval machinery as `getClockNow`, app-lifetime; it lives here beside
 *  the wall clock (domain-agnostic time electricity), not in the boot-deadline policy
 *  module, so the next monotonic-ticker consumer finds it rather than copying it. */
export const getMonotonicNow = makeTickingClock(() => performance.now());
