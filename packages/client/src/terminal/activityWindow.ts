/** Activity-window vocabulary shared by the canvas minimap's window selector
 *  and the workspace switcher's Idle column.
 *
 *  Single source of truth: each window carries its display label and its
 *  staleness threshold (or `null` for "no filter"). Adding a new window is
 *  one entry in `WINDOWS` plus one in `WINDOW_VALUES` for display order.
 *
 *  The same threshold ladder (4h, 12h, 24h, 48h) drives the switcher's
 *  Idle sub-buckets — `IDLE_BUCKETS` derives directly from `WINDOWS`, so
 *  picking `12h` on the minimap is the same horizon as the `12–24h` /
 *  `24–48h` / `48h+` sub-rows in the switcher's Idle column. One vocab,
 *  two surfaces. */

import { HOUR_MS } from "./staleness";

export type MinimapWindow = "all" | "4h" | "12h" | "24h" | "48h";

export interface WindowOption {
  /** Compact label shown inside the minimap trigger button. */
  short: string;
  /** Long label shown in the popover menu and tooltip. */
  label: string;
  /** `null` disables the filter — every tile renders as a full rect. */
  thresholdMs: number | null;
}

/** Single source of truth — a fresh `Record<MinimapWindow, …>` literal is
 *  already exhaustive at the type level: TS's required-property check
 *  fires if a `MinimapWindow` literal is added to the union without a row
 *  here, and excess-property check fires if a row is added without a
 *  matching union member. No casts, no non-null asserts. */
const WINDOWS: Record<MinimapWindow, WindowOption> = {
  all: { short: "All", label: "All terminals", thresholdMs: null },
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
};

/** Display-order list for the popover menu. Object iteration order is the
 *  declaration order above for string keys, but encode it once here so a
 *  reader doesn't have to rely on that invariant at every consumer. */
export const WINDOW_VALUES: readonly MinimapWindow[] = [
  "all",
  "4h",
  "12h",
  "24h",
  "48h",
];

export function isMinimapWindow(value: string): value is MinimapWindow {
  return value in WINDOWS;
}

export function windowOption(w: MinimapWindow): WindowOption {
  return WINDOWS[w];
}

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

/** Convenience: the threshold of a non-"all" window, asserted non-null
 *  at the type boundary so callers don't pay an `as number` tax for
 *  what is structurally guaranteed in `WINDOWS` above. */
type FiniteWindow = Exclude<MinimapWindow, "all">;
function thresholdOf(w: FiniteWindow): number {
  const t = WINDOWS[w].thresholdMs;
  // All non-"all" windows are constructed with a numeric threshold;
  // this is a structural invariant of the literal above. The check is a
  // belt-and-braces guard against a future edit dropping the threshold.
  if (t === null)
    throw new Error(`MinimapWindow "${w}" is missing a thresholdMs`);
  return t;
}

/** Idle sub-bucket boundaries, expressed as pairs of `MinimapWindow`
 *  keys. Each row's `minWindow`/`maxWindow` references — typed as
 *  `MinimapWindow` literals — make the derivation real: removing the
 *  `"24h"` window from `WINDOWS` becomes a type error here, not a
 *  silent runtime drift. The first row's `minWindow` is `"4h"` because
 *  `STALE_THRESHOLD_MS === thresholdOf("4h")` by construction. */
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
 *  a window surfaces as a type error rather than silent drift. */
export const IDLE_BUCKETS: readonly IdleBucket[] = SUB_BUCKET_SPECS.map(
  (spec) => ({
    key: spec.key,
    label: spec.label,
    minMs: thresholdOf(spec.minWindow),
    maxMs: spec.maxWindow === null ? null : thresholdOf(spec.maxWindow),
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
