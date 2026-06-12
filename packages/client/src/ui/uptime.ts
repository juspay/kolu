/** Uptime readouts for the IdentityRail — a shared 1s clock plus a compact
 *  formatter. The `srv up 2m` / `pty up 3h` gap is the glanceable proof the
 *  daemon outlived the last server deploy. */

import { createSignal, onCleanup } from "solid-js";

// One coarse, 1s-ticking clock shared by every uptime readout. Module-level so
// all consumers see the same tick; ref-counted so the interval only runs while
// something is mounted.
const [now, setNow] = createSignal(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let refs = 0;

/** Subscribe to the shared 1s clock for the lifetime of the calling component
 *  (auto-unsubscribes on cleanup). Returns the reactive `now` accessor. */
export function useClock(): () => number {
  if (refs++ === 0) timer = setInterval(() => setNow(Date.now()), 1_000);
  onCleanup(() => {
    if (--refs === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return now;
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
