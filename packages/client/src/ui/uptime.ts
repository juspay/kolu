/** Uptime readouts for the IdentityRail — a shared 1s clock plus a compact
 *  formatter. The `srv up 2m` / `pty up 3h` gap is the glanceable proof the
 *  daemon outlived the last server deploy. */

import { type Accessor, createSignal, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

// One coarse, 1s-ticking clock shared by every uptime readout — the same
// `createSharedRoot` idiom `staleness.getNowTicker` uses (at 60s), so the
// reactive owner is the app, not whichever component mounted first, and the
// interval's `onCleanup` lives in that owner.
const getClock = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), 1_000);
  onCleanup(() => clearInterval(id));
  return now;
});

/** The shared 1s clock — a reactive `now` accessor; reading it inside JSX /
 *  `createMemo` re-renders on each tick. */
export function useClock(): () => number {
  return getClock();
}

/** Compact elapsed time since `startedAt` (epoch-ms): `45s`, `12m`, `3h`, `2d`.
 *  Clamps negatives to `0s` (a clock skew between server and browser). */
export function formatUptime(startedAt: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - startedAt) / 1_000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
