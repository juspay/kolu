import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pidIsAlive,
  type WaitForPidGoneResult,
  waitForPidGone,
} from "./waitForPidGone.ts";

/** An `isAlive` that reports "alive" for the first `n` probes, then "gone". */
function aliveForProbes(n: number): {
  isAlive: (pid: number) => boolean;
  probes: () => number;
} {
  let count = 0;
  return {
    isAlive: () => {
      const alive = count < n;
      count += 1;
      return alive;
    },
    probes: () => count,
  };
}

describe("waitForPidGone", () => {
  it("resolves 'gone' immediately when the pid is already dead — no sleep", async () => {
    const sleep = vi.fn(async () => {});
    const result = await waitForPidGone(1234, {
      timeoutMs: 10_000,
      isAlive: () => false,
      sleep,
    });
    expect(result).toBe<WaitForPidGoneResult>("gone");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("polls until the pid exits, then resolves 'gone'", async () => {
    const { isAlive, probes } = aliveForProbes(3); // alive 3×, then gone
    const sleep = vi.fn(async () => {});
    const result = await waitForPidGone(1234, {
      timeoutMs: 10_000,
      pollMs: 50,
      isAlive,
      sleep,
    });
    expect(result).toBe("gone");
    expect(probes()).toBe(4); // 3 alive + 1 gone
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("resolves 'timeout' once the load-aware ceiling elapses while still alive", async () => {
    // A pid that never dies. Drive Date.now() forward via the injected sleep so
    // the deadline is crossed deterministically, no real waiting.
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const result = await waitForPidGone(1234, {
      timeoutMs: 300,
      pollMs: 100,
      isAlive: () => true,
      sleep,
    });
    expect(result).toBe("timeout");
    // probes at t=0,100,200,300 → the t=300 probe trips the deadline.
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("works against the real timer for the default sleep path", async () => {
    vi.useFakeTimers();
    try {
      const { isAlive } = aliveForProbes(2);
      const pending = waitForPidGone(1234, {
        timeoutMs: 10_000,
        pollMs: 100,
        isAlive,
      });
      await vi.advanceTimersByTimeAsync(250); // two 100ms polls + slack
      await expect(pending).resolves.toBe("gone");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("pidIsAlive", () => {
    it("reports the current process as alive", () => {
      expect(pidIsAlive(process.pid)).toBe(true);
    });

    it("reports a certainly-dead pid as gone (ESRCH)", () => {
      // PID_MAX is 2^22 on Linux; this pid cannot exist.
      expect(pidIsAlive(0x7fffffff)).toBe(false);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
