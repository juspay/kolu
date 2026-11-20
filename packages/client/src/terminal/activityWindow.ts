export const HOUR_MS = 60 * 60 * 1000;

export type ActivityWindow = "all" | "4h" | "12h" | "24h" | "48h";

export interface WindowOption {
  /** Compact label shown inside the trigger button. */
  short: string;
  /** Long label shown in the popover menu and tooltip. */
  label: string;
  /** `null` disables the filter — every terminal counts as live. */
  thresholdMs: number | null;
}

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

export const DEFAULT_ACTIVITY_WINDOW: ActivityWindow = "all";

export const WINDOW_OPTIONS: readonly {
  value: ActivityWindow;
  label: string;
}[] = WINDOW_VALUES.map((value) => ({ value, label: WINDOWS[value].label }));

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

type FiniteWindow = Exclude<ActivityWindow, "all">;

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

export const IDLE_BUCKETS: readonly IdleBucket[] = SUB_BUCKET_SPECS.map(
  (spec) => ({
    key: spec.key,
    label: spec.label,
    minMs: WINDOWS[spec.minWindow].thresholdMs,
    maxMs: spec.maxWindow === null ? null : WINDOWS[spec.maxWindow].thresholdMs,
  }),
);

export function idleBucketFor(ageMs: number): IdleBucketKey | null {
  for (const bucket of IDLE_BUCKETS) {
    const aboveMin = ageMs >= bucket.minMs;
    const belowMax = bucket.maxMs === null || ageMs < bucket.maxMs;
    if (aboveMin && belowMax) return bucket.key;
  }
  return null;
}
