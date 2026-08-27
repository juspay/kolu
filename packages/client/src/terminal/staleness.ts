/** Stale-terminal predicate. Pure temporal: a terminal is "stale" when its
 *  last observed agent transition is older than the user's currently-
 *  selected activity window. Agent state is NOT consulted — identity for
 *  stale-but-still-awaiting agents is preserved at the *render* layer
 *  (`QuietRowBody` paints `AgentIndicator` when `meta.agent` is set), not
 *  by exempting them from staleness.
 *
 *  `lastActivityAt` is bumped only on agent semantic-key transitions
 *  (`packages/server/src/meta/agent.ts`), so terminals that never hosted an
 *  agent stay `null` (the honest never-active reading — see `AgentMemorySchema`
 *  in `@kolu/terminal-vocab/schema`) and are excluded — staleness only
 *  applies to terminals whose attention state has actually been observed at
 *  some point.
 *
 *  The active threshold flows from `activityWindowThresholdMs()` in
 *  `activityWindowFilter.ts` — a per-host persisted choice exposed through
 *  one signal so every consumer (dock buckets, minimap fade, badge gate)
 *  agrees on what "stale" means. */

import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { getClockNow, makeTickingClock } from "../time/clock";
import { type IdleBucketKey, idleBucketFor } from "./activityWindow";
import { activityWindowThresholdMs } from "./activityWindowFilter";

const TICK_MS = 60_000;

/** Pure stale predicate.
 *
 *  Stale ⇔ `lastActivityAt` is a real epoch AND `now - lastActivityAt >
 *  thresholdMs`. A `null` threshold disables the feature (never stale). A
 *  `null` `lastActivityAt` — the honest never-active reading, never an
 *  in-band `0` — excludes terminals whose agent transitions have never been
 *  observed (plain shells, brand-new terminals). */
export function isStale(
  lastActivityAt: number | null,
  now: number,
  thresholdMs: number | null,
): boolean {
  if (thresholdMs === null) return false;
  if (lastActivityAt === null) return false;
  return now - lastActivityAt > thresholdMs;
}

/** Lazily-initialized 60s wall-clock ticker. One signal for the whole app —
 *  re-evaluating staleness once a minute is sufficient (the threshold is
 *  measured in hours; a 60s ceiling on visual lag is invisible).
 *
 *  Built off the shared `makeTickingClock` machinery in `time/clock.ts` (the same
 *  receptacle `getClockNow` uses) — a 60s cadence over `Date.now`, app-lifetime with
 *  no teardown, so the tick machinery lives in ONE place. */
// HOST-SCOPING: host-INDEPENDENT by design — deliberately the LOCAL wall clock, not
// a per-host one; `reprojectClock` handles host skew before the `isStale` comparison.
const getNowTicker = makeTickingClock(Date.now, TICK_MS);

/** Reactive stale check. Returns a function consumers call per terminal —
 *  invoking it inside a tracking context (JSX, `createMemo`) subscribes
 *  to both the periodic tick and the user's activity-window choice, so
 *  views re-bucket automatically when either advances. */
export function useStaleCheck(): (lastActivityAt: number | null) => boolean {
  const tick = getNowTicker();
  return (lastActivityAt) =>
    isStale(lastActivityAt, tick(), activityWindowThresholdMs());
}

/** Reactive idle classifier — returns the matching idle sub-bucket for
 *  a terminal, or `null` when the terminal is still live.
 *
 *  Routes through `isStale` first so the "is parked" boundary is
 *  identical to `useStaleCheck`'s — without this, `isStale` (strict `>`)
 *  and `idleBucketFor` (inclusive `>=` on the first bucket) would
 *  disagree at the exact `now - lastActivityAt === thresholdMs` tick.
 *  The shared gate also carries the never-active (`null`) plain-shell
 *  exclusion. */
export function useIdleClassifier(): (
  lastActivityAt: number | null,
) => IdleBucketKey | null {
  const tick = getNowTicker();
  return (lastActivityAt) => {
    const now = tick();
    if (!isStale(lastActivityAt, now, activityWindowThresholdMs())) return null;
    // `isStale` already excluded `null`, so this is a real epoch.
    return idleBucketFor(now - (lastActivityAt as number));
  };
}

/** Reactive elapsed-since formatter. Returns a function consumers call with a
 *  start timestamp — invoking it inside a tracking context (JSX, `createMemo`)
 *  subscribes to the shared **1s** clock, so a "Running for" readout counts up
 *  live (`1s → 2s → …`) through its sub-minute window. The 1s cadence (not
 *  staleness's 60s `getNowTicker`) is what the phrase's seconds tier needs;
 *  past a minute the per-second recompute yields the same string, a no-op
 *  SolidJS skips, and the clock is the one the chrome-bar uptime already runs —
 *  no new timer.
 *
 *  The WORDS are `@kolu/terminal-vocab/duration`'s; what is kolu-client's here,
 *  and the only thing that ever was, is the clock. */
export function useDuration(): (startedAtMs: number) => string {
  const tick = getClockNow();
  return (startedAtMs) => compactPhrase(tick() - startedAtMs);
}

/** Compact "5m ago" / "2h ago" / "3d ago" — empty string for `null`
 *  (= "no agent transition observed yet"), "just now" under a minute.
 *
 *  The phrase is `@kolu/terminal-vocab/duration`'s `agoPhrase`; this binds it to
 *  a plain `Date.now()` read, not a reactive one, because tooltips and hover
 *  panels recompute on mount — finer-grained than the 60s tick anyway. The clock
 *  is the only thing this adds, which is why the phrase is not here. */
export function formatTimeAgo(ts: number | null): string {
  return agoPhrase(ts, Date.now());
}
