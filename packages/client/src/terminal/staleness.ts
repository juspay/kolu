/** Stale-terminal predicate. A terminal is "stale" when its last observed
 *  agent transition is older than the auto-park threshold.
 *
 *  `lastActivityAt` is bumped only on agent semantic-key transitions
 *  (`packages/server/src/meta/agent.ts`), so terminals that never hosted an
 *  agent stay at `0` and are excluded — staleness only applies to terminals
 *  whose attention state has actually been observed at some point.
 *
 *  The threshold is a constant; if a preference knob ever becomes useful,
 *  it lands in `Preferences` and flows through this module without
 *  consumers changing. Consumers compose via `useStaleCheck` and then
 *  combine with `agentBucket()` from the workspace-switcher model when
 *  the conjunction with bucket state is the actual concept. */

import { type Accessor, createRoot, createSignal, onCleanup } from "solid-js";
import { type IdleBucketKey, idleBucketFor } from "./activityWindow";

export const HOUR_MS = 60 * 60 * 1000;
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
 *  measured in hours; a 60s ceiling on visual lag is invisible).
 *
 *  Wrapped in `createRoot` so the signal's reactive owner is the app
 *  itself, not whichever component happened to call `useStaleCheck()`
 *  first. Without that, a fast-refresh or test-teardown that disposed
 *  the first caller's owner would orphan the ticker and silently freeze
 *  every consumer. */
function getNowTicker(): Accessor<number> {
  if (nowSignal !== null) return nowSignal;
  nowSignal = createRoot(() => {
    const [now, setNow] = createSignal(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    onCleanup(() => clearInterval(id));
    return now;
  });
  return nowSignal;
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

/** Reactive idle classifier — returns the matching idle sub-bucket for
 *  a `lastActivityAt`, or `null` when the terminal is still live.
 *
 *  Routes through `isStale` first so the "is parked" boundary is
 *  identical to `useStaleCheck`'s — without this, `isStale` (strict `>`)
 *  and `idleBucketFor` (inclusive `>=` on the first bucket) would
 *  disagree at the exact `now - lastActivityAt === STALE_THRESHOLD_MS`
 *  tick: the Collapsed pill would still read live while the switcher
 *  panel had moved the entry into the Idle column. The shared gate
 *  also picks up the `lastActivityAt === 0` plain-shell exclusion. */
export function useIdleClassifier(): (
  lastActivityAt: number,
) => IdleBucketKey | null {
  const tick = getNowTicker();
  return (lastActivityAt: number) => {
    const now = tick();
    if (!isStale(lastActivityAt, now, STALE_THRESHOLD_MS)) return null;
    return idleBucketFor(now - lastActivityAt);
  };
}

/** Reactive stale check with a caller-supplied threshold accessor. Same
 *  composition shape as `useStaleCheck`, but the consumer drives the
 *  threshold (e.g. the minimap's user-selected activity window). Passing
 *  `null` from the accessor disables the check — every input is fresh. */
export function useStaleCheckWith(
  thresholdMs: Accessor<number | null>,
): (lastActivityAt: number) => boolean {
  const tick = getNowTicker();
  return (lastActivityAt: number) =>
    isStale(lastActivityAt, tick(), thresholdMs());
}

/** Compact "5m ago" / "2h ago" / "3d ago" — empty string for `0`
 *  (= "no agent transition observed yet"). Plain `Date.now()` read,
 *  not reactive: tooltips and hover panels recompute on mount, which is
 *  finer-grained than the 60s tick anyway. */
export function formatTimeAgo(ts: number): string {
  if (ts === 0) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
