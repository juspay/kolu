/** Stale-terminal predicate: a terminal is stale when its last observed agent
 *  transition is older than the active activity window. */

import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { getClockNow, makeTickingClock } from "../time/clock";
import { type IdleBucketKey, idleBucketFor } from "./activityWindow";
import { activityWindowThresholdMs } from "./activityWindowFilter";

const TICK_MS = 60_000;

/** Pure stale predicate. A `null` threshold disables the feature; a `null`
 *  `lastActivityAt` is never stale. */
export function isStale(
  lastActivityAt: number | null,
  now: number,
  thresholdMs: number | null,
): boolean {
  if (thresholdMs === null) return false;
  if (lastActivityAt === null) return false;
  return now - lastActivityAt > thresholdMs;
}

/** 60s wall-clock ticker, shared app-wide. Deliberately the LOCAL clock —
 *  `reprojectClock` handles host skew before the `isStale` comparison. */
export const getNowTicker = makeTickingClock(Date.now, TICK_MS);

/** Reactive stale check — call the returned function per terminal inside a
 *  tracking context. */
export function useStaleCheck(): (lastActivityAt: number | null) => boolean {
  const tick = getNowTicker();
  return (lastActivityAt) =>
    isStale(lastActivityAt, tick(), activityWindowThresholdMs());
}

/** Reactive idle classifier — the matching idle sub-bucket for a terminal, or
 *  `null` when it is still live. Routes through `isStale` so the parked
 *  boundary matches {@link useStaleCheck}'s. */
export function useIdleClassifier(): (
  lastActivityAt: number | null,
) => IdleBucketKey | null {
  const tick = getNowTicker();
  return (lastActivityAt) => {
    const now = tick();
    if (!isStale(lastActivityAt, now, activityWindowThresholdMs())) return null;
    return idleBucketFor(now - (lastActivityAt as number));
  };
}

/** Reactive elapsed-since formatter over the shared 1s clock. */
export function useDuration(): (startedAtMs: number) => string {
  const tick = getClockNow();
  return (startedAtMs) => compactPhrase(tick() - startedAtMs);
}

/** Compact "5m ago" / "2h ago" / "3d ago" — empty string for `null`,
 *  "just now" under a minute. */
export function formatTimeAgo(ts: number | null): string {
  return agoPhrase(ts, Date.now());
}
