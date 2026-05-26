/** Stale-terminal predicate. Pure temporal: a terminal is "stale" when its
 *  last observed agent transition is older than the user's currently-
 *  selected activity window. Agent state is NOT consulted — identity for
 *  stale-but-still-awaiting agents is preserved at the *render* layer
 *  (`QuietRowBody` paints `AgentIndicator` when `meta.agent` is set), not
 *  by exempting them from staleness.
 *
 *  `lastActivityAt` is bumped only on agent semantic-key transitions
 *  (`packages/server/src/meta/agent.ts`), so terminals that never hosted an
 *  agent stay at `0` and are excluded — staleness only applies to terminals
 *  whose attention state has actually been observed at some point.
 *
 *  The active threshold flows from `activityWindowThresholdMs()` in
 *  `activityWindow.ts` — a per-device persisted choice exposed through
 *  one signal so every consumer (dock buckets, minimap fade, badge gate)
 *  agrees on what "stale" means. */

import { type Accessor, createSignal, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import {
  activityWindowThresholdMs,
  type IdleBucketKey,
  idleBucketFor,
} from "./activityWindow";

const TICK_MS = 60_000;

/** Pure stale predicate.
 *
 *  Stale ⇔ `lastActivityAt > 0` AND `now - lastActivityAt > thresholdMs`.
 *  A `null` threshold disables the feature (never stale). The
 *  `lastActivityAt === 0` guard excludes terminals whose agent
 *  transitions have never been observed (plain shells, brand-new
 *  terminals). */
export function isStale(
  lastActivityAt: number,
  now: number,
  thresholdMs: number | null,
): boolean {
  if (thresholdMs === null) return false;
  if (lastActivityAt === 0) return false;
  return now - lastActivityAt > thresholdMs;
}

/** Lazily-initialized monotonic-ish ticker. One signal for the whole app —
 *  re-evaluating staleness once a minute is sufficient (the threshold is
 *  measured in hours; a 60s ceiling on visual lag is invisible).
 *
 *  Shares the `createSharedRoot` singleton idiom with `useDockOrder` so
 *  the reactive owner is the app, not whichever component called us
 *  first; the `onCleanup` for the interval lives inside that owner. */
const getNowTicker = createSharedRoot<Accessor<number>>(() => {
  const [now, setNow] = createSignal(Date.now());
  const id = setInterval(() => setNow(Date.now()), TICK_MS);
  onCleanup(() => clearInterval(id));
  return now;
});

/** Reactive stale check. Returns a function consumers call per terminal —
 *  invoking it inside a tracking context (JSX, `createMemo`) subscribes
 *  to both the periodic tick and the user's activity-window choice, so
 *  views re-bucket automatically when either advances. */
export function useStaleCheck(): (lastActivityAt: number) => boolean {
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
 *  The shared gate also carries the `lastActivityAt === 0` plain-shell
 *  exclusion. */
export function useIdleClassifier(): (
  lastActivityAt: number,
) => IdleBucketKey | null {
  const tick = getNowTicker();
  return (lastActivityAt) => {
    const now = tick();
    if (!isStale(lastActivityAt, now, activityWindowThresholdMs())) return null;
    return idleBucketFor(now - lastActivityAt);
  };
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
