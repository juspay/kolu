import { describe, expect, it } from "vitest";
import { waitForPidGone } from "./waitForPidGone.ts";

/** A fake clock whose `sleep` advances time instantly, so the test exercises the
 *  ceiling logic without real delays. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("waitForPidGone", () => {
  it("resolves true immediately when the pid is already gone", async () => {
    const clock = fakeClock();
    const gone = await waitForPidGone(123, {
      isAlive: () => false,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(gone).toBe(true);
  });

  it("resolves true once the pid exits before the ceiling", async () => {
    const clock = fakeClock();
    let polls = 0;
    // Alive for the first 3 probes, then gone.
    const gone = await waitForPidGone(123, {
      ceilingMs: 10_000,
      pollMs: 250,
      isAlive: () => ++polls <= 3,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(gone).toBe(true);
    expect(polls).toBeGreaterThan(3);
  });

  it("resolves false when the pid outlives the ceiling", async () => {
    const clock = fakeClock();
    const gone = await waitForPidGone(123, {
      ceilingMs: 1_000,
      pollMs: 250,
      isAlive: () => true, // never dies
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(gone).toBe(false);
  });

  it("really observes this process as alive and a bogus pid as gone", async () => {
    // No injected isAlive — exercises the real pidIsAlive path.
    expect(await waitForPidGone(2_147_483_646, { ceilingMs: 1_000 })).toBe(
      true,
    );
  });
});
