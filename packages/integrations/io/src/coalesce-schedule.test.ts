import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
} from "./coalesce-schedule.ts";
import { DEFAULT_APPEND_POLL_MS } from "./file-append-watcher.ts";

describe("createCoalesceSchedule", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
    await vi.advanceTimersByTimeAsync(39);
    expect(fires).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
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

    const started = Date.now();
    s.schedule();
    for (let elapsed = 25; elapsed <= 300; elapsed += 25) {
      await vi.advanceTimersByTimeAsync(25);
      s.schedule();
    }

    expect(fires).toBeGreaterThanOrEqual(1);
    expect(firstFireAt).not.toBeNull();
    expect(firstFireAt! - started).toBe(maxWaitMs);
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
    await vi.advanceTimersByTimeAsync(50);
    expect(fires).toBe(0);
    s.schedule();
    await vi.advanceTimersByTimeAsync(50);
    expect(fires).toBe(0);
  });
});
