/** Live-uptime readouts for the IdentityRail's `srv` / `pty` columns.
 *
 *  `formatUptime` is the pure formatter (unit-tested); `useNow` is the
 *  shared, app-owned wall-clock that advances every second so every uptime
 *  on screen ticks in lockstep off a single interval — the same
 *  `createSharedRoot` idiom as `staleness.getNowTicker`. */

import { type Accessor, createSignal, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";

/** Compact uptime: `up 12s` / `up 3m` / `up 5h` / `up 2d`. Returns `null`
 *  when the start time is unknown (no daemon read, or a pre-uptime build) so
 *  the caller renders nothing rather than a bogus duration. Coarse single-unit
 *  output — the rail wants a glanceable "how long has this been up", not a
 *  stopwatch. */
export function formatUptime(
  startedAt: number | undefined,
  now: number,
): string | null {
  if (!startedAt) return null;
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `up ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `up ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `up ${hr}h`;
  return `up ${Math.floor(hr / 24)}d`;
}

/** Absolute boot time for the uptime tooltip — local-time string, or `null`
 *  when unknown. A plain `Date` read; tooltips recompute on hover. */
export function bootLabel(startedAt: number | undefined): string | null {
  if (!startedAt) return null;
  return new Date(startedAt).toLocaleString();
}

/** A shared, app-owned wall-clock advancing every second. One signal for
 *  every live-duration readout (the rail's two uptimes today) so they share a
 *  single interval and tick together. Owned by the app via `createSharedRoot`,
 *  so the first consumer's teardown doesn't freeze the clock for the rest. */
export const useNow = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(id));
  return now;
});
