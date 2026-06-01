/** Activity-window vocabulary shared by every surface that asks "how stale
 *  is too stale before I stop caring?" — the dock's row-bucket classifier,
 *  the canvas minimap's tile fading, the workspace switcher's Idle column,
 *  the canvas tile dimming, and the badge-attention gate.
 *
 *  One vocabulary, one persisted user choice — see `useActivityWindow`. */

/** One hour in milliseconds. Lives here (and not in `staleness.ts`) so
 *  the threshold ladder used by `WINDOWS` has a single source with a
 *  one-direction import — `staleness.ts` reads it from this module rather
 *  than the other way around, breaking the module-init cycle that would
 *  otherwise leave `HOUR_MS` in TDZ when `activityWindow.ts` evaluates
 *  first under the bundler's resolution order. */
export const HOUR_MS = 60 * 60 * 1000;

import { persistedPref } from "../persistedPref";

export type ActivityWindow = "all" | "4h" | "12h" | "24h" | "48h";

export interface WindowOption {
  /** Compact label shown inside the trigger button. */
  short: string;
  /** Long label shown in the popover menu and tooltip. */
  label: string;
  /** `null` disables the filter — every terminal counts as live. */
  thresholdMs: number | null;
}

/** Single source of truth — `as const satisfies Record<ActivityWindow, …>`
 *  preserves each row's per-key narrowing while still enforcing
 *  exhaustiveness against the union. The `all` row's `thresholdMs`
 *  type-narrows to `null`; every other row narrows to `number`. Internal
 *  consumers (e.g. `IDLE_BUCKETS` boundaries) read `WINDOWS[key].thresholdMs`
 *  directly and get the narrowed type without any unwrap helper or
 *  `as number` cast — pushing the invariant to the type at its source per
 *  the `no-untyped-escape-hatches` rule. */
const WINDOWS = {
  all: { short: "All", label: "Show all terminals", thresholdMs: null },
  "4h": { short: "4h", label: "Active in last 4h", thresholdMs: 4 * HOUR_MS },
  "12h": {
    short: "12h",
    label: "Active in last 12h",
    thresholdMs: 12 * HOUR_MS,
  },
  "24h": {
    short: "24h",
    label: "Active in last 24h",
    thresholdMs: 24 * HOUR_MS,
  },
  "48h": {
    short: "48h",
    label: "Active in last 48h",
    thresholdMs: 48 * HOUR_MS,
  },
} as const satisfies Record<ActivityWindow, WindowOption>;

/** Display-order list for the popover menu. Object iteration order is the
 *  declaration order above for string keys, but encode it once here so a
 *  reader doesn't have to rely on that invariant at every consumer. */
export const WINDOW_VALUES: readonly ActivityWindow[] = [
  "all",
  "4h",
  "12h",
  "24h",
  "48h",
];

export function isActivityWindow(value: string): value is ActivityWindow {
  return value in WINDOWS;
}

export function windowOption(w: ActivityWindow): WindowOption {
  return WINDOWS[w];
}

/** Default activity window. `24h` because the immediate user pain is "I
 *  closed the laptop overnight; this morning my waiting agents look like
 *  plain shells" — a 24h horizon keeps yesterday's queue compressed into
 *  parked rows where each row still carries its agent identity (the
 *  parked-row AgentIndicator), without a wall of full reply cards
 *  drowning out fresh waiters. */
export const DEFAULT_ACTIVITY_WINDOW: ActivityWindow = "24h";

/** Per-device user choice of activity window. Singleton — one persisted
 *  store consumed by every surface that filters by staleness (dock,
 *  minimap, tile fade, badge gate). Localstorage-backed via makePersisted
 *  so the same setter from any surface updates every reader. */
export const [activityWindow, setActivityWindow] =
  persistedPref<ActivityWindow>({
    name: "kolu-activity-window",
    fallback: DEFAULT_ACTIVITY_WINDOW,
    parse: (raw) => (isActivityWindow(raw) ? raw : DEFAULT_ACTIVITY_WINDOW),
  });

/** Reactive threshold (ms) for the currently-selected activity window.
 *  `null` when the user picked `"all"` — staleness is disabled. */
export function activityWindowThresholdMs(): number | null {
  return WINDOWS[activityWindow()].thresholdMs;
}

/** Pre-built `{value, label}` list for the activity-window picker menus —
 *  shared by the dock chip and the minimap chip so the option set is
 *  defined exactly once. */
export const WINDOW_OPTIONS: readonly {
  value: ActivityWindow;
  label: string;
}[] = WINDOW_VALUES.map((value) => ({ value, label: WINDOWS[value].label }));

/** Idle sub-bucket keys, ordered most-recent → oldest. The "4h-12h" entry
 *  is the freshest slice of the parked set: terminals that crossed the
 *  4h auto-park threshold but are still inside the 12h window. */
export type IdleBucketKey = "4h-12h" | "12h-24h" | "24h-48h" | "48h+";

export interface IdleBucket {
  key: IdleBucketKey;
  /** Compact range label rendered next to the sub-row (e.g. "4–12h"). */
  label: string;
  /** Inclusive lower bound on age (ms-since-last-activity). */
  minMs: number;
  /** Exclusive upper bound on age, or `null` for the open-ended `48h+`. */
  maxMs: number | null;
}

/** Windows whose `thresholdMs` is structurally `number` (not `null`) —
 *  i.e. every member of `ActivityWindow` except `"all"`. Used by
 *  `IDLE_BUCKETS` to reference window boundaries via their literal keys
 *  while still reading `WINDOWS[k].thresholdMs` as a non-nullable
 *  `number` (no `!`, no unwrap helper, no throw). */
type FiniteWindow = Exclude<ActivityWindow, "all">;

/** Idle sub-bucket boundaries, expressed as pairs of `ActivityWindow`
 *  keys. Each row's `minWindow`/`maxWindow` references — typed as
 *  `FiniteWindow` literals — make the derivation real: removing the
 *  `"24h"` window from `WINDOWS` becomes a type error here, not a
 *  silent runtime drift. The first row's `minWindow` is `"4h"` because
 *  the smallest non-null filter horizon happens to be `"4h"`. */
const SUB_BUCKET_SPECS = [
  { key: "4h-12h", label: "4–12h", minWindow: "4h", maxWindow: "12h" },
  { key: "12h-24h", label: "12–24h", minWindow: "12h", maxWindow: "24h" },
  { key: "24h-48h", label: "24–48h", minWindow: "24h", maxWindow: "48h" },
  { key: "48h+", label: "48h+", minWindow: "48h", maxWindow: null },
] as const satisfies readonly {
  key: IdleBucketKey;
  label: string;
  minWindow: FiniteWindow;
  maxWindow: FiniteWindow | null;
}[];

/** Idle sub-buckets — the workspace switcher's "Idle" column groups parked
 *  terminals by age into these four ranges. Ordering matches display order
 *  (freshest at the top). Boundaries are looked up live from `WINDOWS`
 *  via the `minWindow`/`maxWindow` references in `SUB_BUCKET_SPECS`, so
 *  changing a window's threshold ripples here automatically and removing
 *  a window surfaces as a type error rather than silent drift.
 *
 *  `WINDOWS[spec.minWindow].thresholdMs` is statically `number` (the
 *  `as const satisfies` on `WINDOWS` narrows the `"all"` arm's `null`
 *  away from every other arm), so there is no unwrap step here. */
export const IDLE_BUCKETS: readonly IdleBucket[] = SUB_BUCKET_SPECS.map(
  (spec) => ({
    key: spec.key,
    label: spec.label,
    minMs: WINDOWS[spec.minWindow].thresholdMs,
    maxMs: spec.maxWindow === null ? null : WINDOWS[spec.maxWindow].thresholdMs,
  }),
);

/** Classify an age (in ms since last activity) into an idle sub-bucket.
 *  Returns `null` when `ageMs` is below the auto-park threshold — i.e. the
 *  terminal is still live and shouldn't be in the Idle column at all. */
export function idleBucketFor(ageMs: number): IdleBucketKey | null {
  for (const bucket of IDLE_BUCKETS) {
    const aboveMin = ageMs >= bucket.minMs;
    const belowMax = bucket.maxMs === null || ageMs < bucket.maxMs;
    if (aboveMin && belowMax) return bucket.key;
  }
  return null;
}
