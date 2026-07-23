/**
 * Primitive-level starvation regression for `createCoalesceSchedule`
 * (juspay/kolu#1952). No fs.watch — pure schedule() bursts so the maxWait
 * guarantee is proven at the source, independent of OS edge delivery.
 */

import { describe, expect, it } from "vitest";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
} from "./coalesce-schedule.ts";
import { DEFAULT_APPEND_POLL_MS } from "./file-append-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createCoalesceSchedule", () => {
  it("COALESCE_MAX_WAIT_MS ≤ DEFAULT_APPEND_POLL_MS (documented invariant)", () => {
    expect(COALESCE_MAX_WAIT_MS).toBeLessThanOrEqual(DEFAULT_APPEND_POLL_MS);
    expect(COALESCE_DEBOUNCE_MS).toBeLessThanOrEqual(COALESCE_MAX_WAIT_MS);
  });

  it("fires after debounceMs of quiet (trailing edge)", async () => {
    let fires = 0;
    const s = createCoalesceSchedule({
      debounceMs: 40,
      maxWaitMs: 200,
      onFire: () => {
        fires++;
      },
    });
    s.schedule();
    await sleep(20);
    expect(fires).toBe(0);
    await sleep(40);
    expect(fires).toBe(1);
    s.destroy();
  });

  it("fires within maxWait under continuous schedule() with no quiet ≥ debounceMs", async () => {
    const debounceMs = 80;
    const maxWaitMs = 200;
    let fires = 0;
    let firstFireAt: number | null = null;
    const s = createCoalesceSchedule({
      debounceMs,
      maxWaitMs,
      onFire: () => {
        fires++;
        if (firstFireAt === null) firstFireAt = Date.now();
      },
    });

    const gapMs = Math.max(10, Math.floor(debounceMs / 3));
    const burstMs = maxWaitMs + debounceMs + 80;
    const started = Date.now();
    let lastScheduleAt = started;
    s.schedule();
    while (Date.now() - started < burstMs) {
      await sleep(gapMs);
      const now = Date.now();
      const gap = now - lastScheduleAt;
      if (gap >= debounceMs) {
        s.destroy();
        throw new Error(
          `burst schedule gap ${gap}ms ≥ debounceMs ${debounceMs} — jitter-corrupted run, not a valid starvation probe`,
        );
      }
      s.schedule();
      lastScheduleAt = Date.now();
    }

    // Must have fired *during* the burst (maxWait), not only after quiet.
    expect(fires).toBeGreaterThanOrEqual(1);
    expect(firstFireAt).not.toBeNull();
    expect(firstFireAt! - started).toBeLessThanOrEqual(maxWaitMs + 80);
    s.destroy();
  });

  it("destroy prevents further fires", async () => {
    let fires = 0;
    const s = createCoalesceSchedule({
      debounceMs: 30,
      maxWaitMs: 100,
      onFire: () => {
        fires++;
      },
    });
    s.schedule();
    s.destroy();
    await sleep(50);
    expect(fires).toBe(0);
    s.schedule(); // no-op
    await sleep(50);
    expect(fires).toBe(0);
  });
});
