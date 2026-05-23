/** Stale-terminal predicate.
 *
 *  A terminal is "stale" when its last observed agent transition is older
 *  than the user's currently-selected activity window. Pure temporal —
 *  agent state is NOT consulted here. The earlier "attention-state agents
 *  are never stale" exemption was a category error: it gave user-blocking
 *  agents permanent prominence (full `AwaitingCardBody` rows with reply
 *  boxes) regardless of how long the user had been away, defeating the
 *  point of the threshold. Identity for stale-but-still-awaiting agents
 *  is preserved instead at the *render* layer — `QuietRowBody` paints
 *  the `AgentIndicator` when `meta.agent` is set — so a 20h-stale
 *  waiting agent shows as a compact parked row with its kind/state
 *  visible, not as a plain shell.
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

import { type Accessor, createRoot, createSignal, onCleanup } from "solid-js";
import type { AgentInfo } from "kolu-common/surface";
import {
  activityWindowThresholdMs,
  type IdleBucketKey,
  idleBucketFor,
} from "./activityWindow";

const TICK_MS = 60_000;

/** Minimal input shape for staleness — every consumer either has full
 *  `TerminalMetadata` (most callsites) or constructs the pair locally
 *  from `lastActivityAt` + a `null` agent (e.g. legacy tests of the pure
 *  predicate). Avoids importing the full `TerminalMetadata` here, which
 *  would drag in surface schema concerns the predicate doesn't need.
 *
 *  `agent` is carried in the shape (not just `lastActivityAt`) so the
 *  rendering layer downstream of `isStale` can still ask "does this
 *  parked row carry a known agent?" via the same value — the predicate
 *  itself ignores `agent`. */
export type StalenessInput = {
  lastActivityAt: number;
  agent: AgentInfo | null;
};

/** Pure stale predicate.
 *
 *  Stale ⇔ `lastActivityAt > 0` AND `now - lastActivityAt > thresholdMs`.
 *  A `null` threshold disables the feature (never stale). The
 *  `lastActivityAt === 0` guard excludes terminals whose agent
 *  transitions have never been observed (plain shells, brand-new
 *  terminals). Agent state is intentionally NOT consulted — see the
 *  module header for why. */
export function isStale(
  input: StalenessInput,
  now: number,
  thresholdMs: number | null,
): boolean {
  if (thresholdMs === null) return false;
  if (input.lastActivityAt === 0) return false;
  return now - input.lastActivityAt > thresholdMs;
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
 *  invoking it inside a tracking context (JSX, `createMemo`) subscribes
 *  to both the periodic tick and the user's activity-window choice, so
 *  views re-bucket automatically when either advances. */
export function useStaleCheck(): (input: StalenessInput) => boolean {
  const tick = getNowTicker();
  return (input) => isStale(input, tick(), activityWindowThresholdMs());
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
  input: StalenessInput,
) => IdleBucketKey | null {
  const tick = getNowTicker();
  return (input) => {
    const now = tick();
    if (!isStale(input, now, activityWindowThresholdMs())) return null;
    return idleBucketFor(now - input.lastActivityAt);
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
