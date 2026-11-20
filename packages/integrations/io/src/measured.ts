/** A number that was measured, or why it was not. Never a zero or a null
 *  standing in for "unknown". */
export type Measured<T> =
  | { readonly kind: "measured"; readonly value: T }
  | { readonly kind: "unmeasured"; readonly reason: string };

export const measured = <T>(value: T): Measured<T> => ({
  kind: "measured",
  value,
});

export const unmeasured = <T>(reason: string): Measured<T> => ({
  kind: "unmeasured",
  reason,
});

/** The one shape every timing in a diagnostic answer takes — children, event
 *  loop stalls and calls alike. All in milliseconds. */
export interface TimingSummary {
  readonly count: number;
  readonly medianMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly sumMs: number;
}

/** Summarize a non-empty sample set (nearest-rank percentiles). An empty set
 *  has no median: callers say why there is no sample instead, so this throws. */
export function summarizeTimings(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const [first] = sorted;
  if (first === undefined) {
    throw new Error("summarizeTimings: no samples to summarize");
  }
  const rank = (p: number): number =>
    sorted[Math.ceil(p * sorted.length) - 1] ?? first;
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    count: sorted.length,
    medianMs: rank(0.5),
    p99Ms: rank(0.99),
    maxMs: rank(1),
    sumMs: sum,
  };
}
