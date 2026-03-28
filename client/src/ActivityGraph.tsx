import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { ActivitySample } from "kolu-common";
import { ACTIVITY_WINDOW_MS } from "kolu-common/config";

const BUCKET_COUNT = 30;
const BUCKET_MS = ACTIVITY_WINDOW_MS / BUCKET_COUNT;

/** Periodic tick interval to age off old bars even when no new events arrive. */
const REFRESH_INTERVAL_MS = 5_000;

/**
 * Compute activity fraction (0–1) per time bucket from transition samples.
 * Single forward pass: walks samples once, accumulating active time per bucket.
 */
function computeBuckets(
  samples: ActivitySample[],
  now: number,
): readonly number[] {
  const result: number[] = new Array(BUCKET_COUNT).fill(0);
  if (samples.length === 0) return result;

  const windowStart = now - ACTIVITY_WINDOW_MS;

  // Find initial state: last transition at or before windowStart
  let si = 0;
  let currentActive = false;
  for (let j = 0; j < samples.length; j++) {
    if (samples[j]![0] > windowStart) break;
    currentActive = samples[j]![1];
    si = j + 1;
  }

  for (let i = 0; i < BUCKET_COUNT; i++) {
    const bStart = windowStart + i * BUCKET_MS;
    const bEnd = bStart + BUCKET_MS;
    let activeMs = 0;
    let segStart = bStart;

    // Process transitions that fall within this bucket
    while (si < samples.length && samples[si]![0] < bEnd) {
      const [time, active] = samples[si]!;
      if (currentActive) activeMs += time - segStart;
      currentActive = active;
      segStart = time;
      si++;
    }
    // Remainder of bucket in current state
    if (currentActive) activeMs += bEnd - segStart;

    result[i] = activeMs / BUCKET_MS;
  }

  return result;
}

/** Mini sparkline showing terminal activity over the last 5 minutes. */
const ActivityGraph: Component<{
  samples: ActivitySample[];
}> = (props) => {
  // Use a signal (not memo) so setInterval can trigger updates from outside reactive scope.
  const [buckets, setBuckets] = createSignal<readonly number[]>(
    new Array(BUCKET_COUNT).fill(0),
    { equals: false },
  );

  const recompute = () => setBuckets(computeBuckets(props.samples, Date.now()));

  // Recompute when samples change (reactive subscription via effect)
  createEffect(() => {
    // Access samples to subscribe to store changes
    props.samples;
    recompute();
  });

  // Periodic recompute: shifts the time window even when no new events arrive
  const timer = setInterval(recompute, REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(timer));

  const hasData = createMemo(() => buckets().some((v) => v > 0));

  return (
    <svg
      data-testid="activity-graph"
      data-has-data={hasData() ? "true" : undefined}
      class="w-full transition-opacity duration-300"
      classList={{ "opacity-0": !hasData() }}
      viewBox={`0 0 ${BUCKET_COUNT} 10`}
      preserveAspectRatio="none"
      style={{ height: "14px" }}
    >
      {Array.from({ length: BUCKET_COUNT }, (_, i) => {
        const val = () => buckets()[i]!;
        const h = () => (val() > 0 ? Math.max(2, val() * 10) : 0);
        return (
          <rect
            x={i}
            y={10 - h()}
            width={0.7}
            height={h()}
            rx={0.2}
            fill="var(--color-ok)"
            opacity={0.4 + val() * 0.6}
          />
        );
      })}
    </svg>
  );
};

export default ActivityGraph;
