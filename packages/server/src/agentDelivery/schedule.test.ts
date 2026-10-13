/**
 * The delivery schedule on a fake clock and a fake delivery, with upstream's
 * real numbers (every six hours from 02:00 UTC; up to three runs a boundary,
 * five minutes after a FAILED one ended): a run when due at start, a failed
 * run retried, a refused-only run NOT retried (only the host's own settings
 * change a refusal), a succeeded run not repeated before the next boundary,
 * and nothing while agents are off.
 */

import type { UpdaterSchedule } from "@kolu/agent-distro/schedule";
import type { Logger } from "@kolu/log";
import { describe, expect, it, vi } from "vitest";
import type { AgentDelivery, HostOutcome } from "./delivery.ts";
import { runFailed, startDeliverySchedule } from "./schedule.ts";

/** Upstream's schedule: every six hours from 02:00 UTC. */
const UPSTREAM: UpdaterSchedule = { periodSeconds: 21600, offsetSeconds: 7200 };
const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

/** Let a resolved run's bookkeeping (`.then`) land. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeClock(start: number) {
  let now = start;
  let pending: { due: number; fn: () => void } | undefined;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      pending = { due: now + ms, fn };
      return () => {
        pending = undefined;
      };
    },
    armedFor: () => pending?.due,
    fire: () => {
      const p = pending;
      if (p === undefined) throw new Error("no timer armed");
      pending = undefined;
      now = p.due;
      p.fn();
    },
  };
}

/** A delivery whose every run ends at once with `outcome()`, recording when
 *  each run started and whether it asked for a fresh lock. */
function fakeDelivery(
  outcome: () => readonly HostOutcome[],
  now: () => number,
) {
  const runs: { at: number; freshLock: boolean }[] = [];
  const delivery: AgentDelivery = {
    running: () => false,
    run: async ({ freshLock }) => {
      runs.push({ at: now(), freshLock });
      return outcome();
    },
  };
  return { delivery, runs };
}

/** Fire the clock's looks (settling each run) until it reaches `until`. */
async function runUntil(clock: ReturnType<typeof fakeClock>, until: number) {
  await settle();
  while ((clock.armedFor() ?? Number.POSITIVE_INFINITY) <= until) {
    clock.fire();
    await settle();
  }
}

function start(opts: {
  start: string;
  outcome: () => readonly HostOutcome[];
  enabled?: boolean;
}) {
  const clock = fakeClock(at(opts.start));
  const { delivery, runs } = fakeDelivery(opts.outcome, clock.now);
  const schedule = startDeliverySchedule({
    delivery,
    schedule: UPSTREAM,
    enabled: () => opts.enabled ?? true,
    log,
    now: clock.now,
    setTimer: clock.setTimer,
  });
  return { clock, runs, schedule };
}

describe("runFailed", () => {
  it("only a failed host fails the run — refused, busy and landed do not", () => {
    expect(runFailed(["landed", "failed"])).toBe(true);
    expect(runFailed(["landed", "refused", "busy"])).toBe(false);
    expect(runFailed([])).toBe(false);
  });
});

describe("startDeliverySchedule", () => {
  it("runs at start when due, with a fresh lock", async () => {
    const { runs, schedule } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["landed"],
    });
    await settle();
    expect(runs).toEqual([{ at: at("2026-10-08T09:00:00Z"), freshLock: true }]);
    schedule.stop();
  });

  it("a succeeded run is not repeated until the next boundary", async () => {
    const { clock, runs, schedule } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["landed"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([at("2026-10-08T09:00:00Z")]);
    await runUntil(clock, at("2026-10-08T14:00:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T14:00:00Z"),
    ]);
    schedule.stop();
  });

  it("a failed run is retried five minutes after it ended, at most three runs a boundary", async () => {
    const { clock, runs, schedule } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["landed", "failed"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T09:00:00Z") + 5 * MIN,
      at("2026-10-08T09:00:00Z") + 10 * MIN,
    ]);
    // The next boundary starts a fresh count.
    await runUntil(clock, at("2026-10-08T14:10:00Z"));
    expect(runs.slice(3).map((r) => r.at)).toEqual([
      at("2026-10-08T14:00:00Z"),
      at("2026-10-08T14:05:00Z"),
      at("2026-10-08T14:10:00Z"),
    ]);
    schedule.stop();
  });

  it("a failed run that then succeeds stops retrying", async () => {
    const outcomes: HostOutcome[][] = [["failed"], ["landed"]];
    const { clock, runs, schedule } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => outcomes.shift() ?? ["landed"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T09:05:00Z"),
    ]);
    schedule.stop();
  });

  it("a refused-only run is not retried before the next boundary", async () => {
    const { clock, runs, schedule } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["refused", "landed"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([at("2026-10-08T09:00:00Z")]);
    await runUntil(clock, at("2026-10-08T14:00:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T14:00:00Z"),
    ]);
    schedule.stop();
  });

  it("runs nothing while agents are off", async () => {
    const { clock, runs, schedule } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["landed"],
      enabled: false,
    });
    await settle();
    expect(runs).toEqual([]);
    expect(clock.armedFor()).toBeUndefined();
    schedule.poke();
    await settle();
    expect(runs).toEqual([]);
    schedule.stop();
  });
});
