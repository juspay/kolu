/* Node's `monitorEventLoopDelay` histogram records the sampling INTERVAL, not
 * the delay: an idle loop at `resolution: 20` reads about 20 ms, so each figure
 * is the reading minus the resolution, floored at zero. */

import { monitorEventLoopDelay } from "node:perf_hooks";
import type { PadiDiagnostics, TimingSummary } from "@kolu/padi-client/surface";
import { measured, unmeasured } from "kolu-io";

const RESOLUTION_MS = 20;
const WINDOW_MS = 60_000;
const NS_PER_MS = 1e6;

export interface StallMonitor {
  read(): PadiDiagnostics["stalls"];
  stop(): void;
}

export function startStallMonitor(): StallMonitor {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  const startedAt = performance.now();
  let windowStartedAt = startedAt;
  let lastMinute: PadiDiagnostics["stalls"]["lastMinute"] | undefined;

  const delayMs = (ns: number): number =>
    Math.max(0, ns / NS_PER_MS - RESOLUTION_MS);
  const summary = (): TimingSummary => ({
    count: histogram.count,
    medianMs: delayMs(histogram.percentile(50)),
    p99Ms: delayMs(histogram.percentile(99)),
    maxMs: delayMs(histogram.max),
    sumMs: delayMs(histogram.mean) * histogram.count,
  });

  const roll = setInterval(() => {
    const now = performance.now();
    lastMinute =
      histogram.count > 0
        ? measured({ summary: summary(), windowMs: now - windowStartedAt })
        : unmeasured("the loop recorded no sample in the last minute");
    histogram.reset();
    windowStartedAt = now;
  }, WINDOW_MS);
  roll.unref();

  return {
    read() {
      const now = performance.now();
      return {
        resolutionMs: RESOLUTION_MS,
        lastMinute:
          lastMinute ??
          unmeasured(
            `measuring for only ${Math.round((now - startedAt) / 1000)} s`,
          ),
        current: {
          summary:
            histogram.count > 0
              ? measured(summary())
              : unmeasured("no sample yet in this minute"),
          elapsedMs: now - windowStartedAt,
        },
      };
    },
    stop() {
      clearInterval(roll);
      histogram.disable();
    },
  };
}
