/** Stale-terminal predicate. A terminal is "stale" when its last observed
 *  agent transition is older than the auto-park threshold.
 *
 *  `lastActivityAt` is bumped only on agent semantic-key transitions
 *  (`packages/server/src/meta/agent.ts`), so terminals that never hosted an
 *  agent stay at `0` and are excluded — staleness only applies to terminals
 *  whose attention state has actually been observed at some point.
 *
 *  Single source for the awaiting badge, the switcher's bucket counts, and
 *  the canvas-tile fade — so all three move together. The threshold is a
 *  constant; if a knob ever becomes useful, it lands in `Preferences` and
 *  flows through this module without consumers changing. */

import { type Accessor, createSignal } from "solid-js";

const HOUR_MS = 60 * 60 * 1000;
const TICK_MS = 60_000;

/** Auto-park threshold. Hardcoded for now; consumers go through the module
 *  rather than the constant so a future preference knob is a one-file
 *  change. */
export const STALE_THRESHOLD_MS = 4 * HOUR_MS;

/** Pure stale predicate.
 *
 *  Stale ⇔ `lastActivityAt > 0` AND `now - lastActivityAt > thresholdMs`.
 *  A `null` threshold disables the feature (never stale). The `lastActivityAt
 *  === 0` guard excludes terminals whose agent transitions have never been
 *  observed (plain shells, brand-new terminals). */
export function isStale(
  lastActivityAt: number,
  now: number,
  thresholdMs: number | null,
): boolean {
  if (thresholdMs === null) return false;
  if (lastActivityAt === 0) return false;
  return now - lastActivityAt > thresholdMs;
}

let nowSignal: Accessor<number> | null = null;

/** Lazily-initialized monotonic-ish ticker. One signal for the whole app —
 *  re-evaluating staleness once a minute is sufficient (the threshold is
 *  measured in hours; a 60s ceiling on visual lag is invisible). */
function getNowTicker(): Accessor<number> {
  if (nowSignal !== null) return nowSignal;
  const [now, setNow] = createSignal(Date.now());
  setInterval(() => setNow(Date.now()), TICK_MS);
  nowSignal = now;
  return now;
}

/** Reactive stale check. Returns a function consumers call per terminal —
 *  invoking it inside a tracking context (JSX, `createMemo`) subscribes to
 *  the periodic tick, so views fade and un-fade automatically as `now`
 *  advances and as agent transitions update `lastActivityAt`. */
export function useStaleCheck(): (lastActivityAt: number) => boolean {
  const tick = getNowTicker();
  return (lastActivityAt: number) =>
    isStale(lastActivityAt, tick(), STALE_THRESHOLD_MS);
}
