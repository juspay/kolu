/** Shared app-wide wall clock. One owned interval, via the `createSharedRoot`
 *  singleton idiom (the same one `staleness.ts`'s `getNowTicker` and
 *  `useDockOrder` use), so every second-granularity readout subscribes to ONE
 *  live `now` signal instead of spinning a timer apiece. */

import { type Accessor, createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

/** `Date.now()` that advances every second. Drives the second-granularity live
 *  readouts — the chrome-bar kaval uptime and the inspector's "Running for" —
 *  off a single shared interval. Reading it in a tracking context (JSX/memo)
 *  re-renders that consumer each second; a hidden tab throttles the interval to
 *  ~1/min on its own, so the background cost matches a coarse ticker anyway.
 *
 *  Distinct from `staleness.ts`'s 60s `getNowTicker`: staleness is hours-scale,
 *  where a 60s visual lag is invisible and a per-second wake would be waste —
 *  so the two cadences stay separate, each owning the readouts it fits. */
export const getClockNow = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  // App-lifetime by `createSharedRoot`'s contract: this interval is the app's one
  // wall clock and ticks for the whole session — there is no teardown (the shared
  // root's disposer is intentionally discarded), so we do NOT register an
  // `onCleanup` that would never run. The browser reclaims the timer on page close.
  setInterval(() => setNow(Date.now()), 1_000);
  return now;
});
