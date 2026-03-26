import { type Component, createMemo, createSignal, onCleanup } from "solid-js";
import { type ActivitySample, ACTIVITY_WINDOW_MS } from "./useTerminals";

const BUCKET_COUNT = 30;

/** Periodic tick interval to age off old bars even when no new events arrive. */
const REFRESH_INTERVAL_MS = 10_000;

/** Mini sparkline showing terminal activity over the last 5 minutes. */
const ActivityGraph: Component<{
  samples: ActivitySample[];
}> = (props) => {
  // Tick signal: forces bucket recomputation so old activity ages off the graph.
  const [tick, setTick] = createSignal(0);
  const timer = setInterval(() => setTick((n) => n + 1), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(timer));

  /** Compute activity fraction (0–1) per time bucket. */
  const buckets = createMemo(() => {
    void tick(); // subscribe to periodic refresh
    const now = Date.now();
    const windowStart = now - ACTIVITY_WINDOW_MS;
    const bucketMs = ACTIVITY_WINDOW_MS / BUCKET_COUNT;
    const samples = props.samples;
    const result = new Float32Array(BUCKET_COUNT);

    if (samples.length === 0) return result;

    for (let i = 0; i < BUCKET_COUNT; i++) {
      const bStart = windowStart + i * bucketMs;
      const bEnd = bStart + bucketMs;

      // Find the activity state at bStart by looking at the last sample before bStart
      let stateAtStart = false;
      for (let j = samples.length - 1; j >= 0; j--) {
        if (samples[j]![0] <= bStart) {
          stateAtStart = samples[j]![1];
          break;
        }
      }

      // Calculate active time within this bucket
      let activeMs = 0;
      let currentState = stateAtStart;
      let currentTime = bStart;

      for (const [time, active] of samples) {
        if (time <= bStart) continue;
        if (time >= bEnd) break;
        if (currentState) activeMs += time - currentTime;
        currentState = active;
        currentTime = time;
      }
      // Remaining time in bucket
      if (currentState) activeMs += bEnd - currentTime;

      result[i] = activeMs / bucketMs;
    }

    return result;
  });

  /** True if there's any activity data worth showing. */
  const hasData = createMemo(() => {
    const b = buckets();
    for (let i = 0; i < b.length; i++) if (b[i]! > 0) return true;
    return false;
  });

  return (
    <svg
      class="w-full transition-opacity duration-300"
      classList={{ "opacity-0": !hasData() }}
      viewBox={`0 0 ${BUCKET_COUNT} 10`}
      preserveAspectRatio="none"
      style={{ height: "14px" }}
    >
      {Array.from({ length: BUCKET_COUNT }, (_, i) => {
        const h = () => Math.max(buckets()[i]! > 0 ? 2 : 0, buckets()[i]! * 10);
        return (
          <rect
            x={i}
            y={10 - h()}
            width={0.7}
            height={h()}
            rx={0.2}
            fill={
              buckets()[i]! > 0 ? "var(--color-ok)" : "var(--color-surface-3)"
            }
            opacity={buckets()[i]! > 0 ? 0.4 + buckets()[i]! * 0.6 : 0.3}
          />
        );
      })}
    </svg>
  );
};

export default ActivityGraph;
