/**
 * The delivery schedule on a fake clock and a fake delivery, with upstream's
 * real numbers (every six hours from 02:00 UTC; up to three runs a boundary,
 * five minutes after a FAILED one ended): a run when due at start, a failed
 * run retried, a run that reached no host retried (never stamped), a
 * succeeded run not repeated before the next boundary,
 * and nothing while agents are off.
 */

import {
  SCHEDULED_ATTEMPTS,
  SCHEDULED_RETRY_SECONDS,
} from "@juspay/agent-distro/update/due";
import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import type { Logger } from "@kolu/log";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentDelivery,
  DeliveryTrigger,
  HostOutcome,
} from "./delivery.ts";
import {
  attemptEnded,
  attemptStarted,
  runFailed,
  type ScheduledAttempts,
  scheduledAskNow,
  startDeliverySchedule,
} from "./schedule.ts";

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
 *  each run started and its trigger. */
function fakeDelivery(
  outcome: () => readonly HostOutcome[],
  now: () => number,
) {
  const runs: { at: number; trigger: DeliveryTrigger }[] = [];
  const delivery: AgentDelivery = {
    running: () => false,
    resolve: async () => {},
    run: async ({ trigger }) => {
      runs.push({ at: now(), trigger });
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
  it("a failed host fails the run — busy and landed do not", () => {
    expect(runFailed(["landed", "failed"])).toBe(true);
    expect(runFailed(["landed", "busy"])).toBe(false);
    expect(runFailed(["landed"])).toBe(false);
  });

  it("a run that reached no host failed", () => {
    expect(runFailed([])).toBe(true);
    expect(runFailed(["busy"])).toBe(true);
    expect(runFailed(["busy", "busy"])).toBe(true);
  });
});

describe("startDeliverySchedule", () => {
  it("runs at start when due, as the schedule's trigger", async () => {
    const { runs } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["landed"],
    });
    await settle();
    expect(runs).toEqual([
      { at: at("2026-10-08T09:00:00Z"), trigger: "schedule" },
    ]);
  });

  it("a succeeded run is not repeated until the next boundary", async () => {
    const { clock, runs } = start({
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
  });

  it("a failed run is retried five minutes after it ended, at most three runs a boundary", async () => {
    const { clock, runs } = start({
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
  });

  it("a failed run that then succeeds stops retrying", async () => {
    const outcomes: HostOutcome[][] = [["failed"], ["landed"]];
    const { clock, runs } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => outcomes.shift() ?? ["landed"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T09:05:00Z"),
    ]);
  });

  it("a run that reached no host is not stamped, and is retried five minutes later", async () => {
    const outcomes: HostOutcome[][] = [[], ["landed"]];
    const { clock, runs } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => outcomes.shift() ?? ["landed"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T09:05:00Z"),
    ]);
  });

  it("an all-busy run is retried within the boundary's three-run budget", async () => {
    const { clock, runs } = start({
      start: "2026-10-08T09:00:00Z",
      outcome: () => ["busy", "busy"],
    });
    await runUntil(clock, at("2026-10-08T13:59:00Z"));
    expect(runs.map((r) => r.at)).toEqual([
      at("2026-10-08T09:00:00Z"),
      at("2026-10-08T09:05:00Z"),
      at("2026-10-08T09:10:00Z"),
    ]);
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
  });
});

describe("scheduledAskNow — a boundary, a missed ask, and upstream's retries", () => {
  // A fake clock walked in the timer's 5-minute steps from the 08:00 boundary.
  const t0 = at("2026-10-08T08:00:00Z") / 1000;
  const ask = (
    now: number,
    attempts: ScheduledAttempts | undefined,
    extra: { boundaryPassed?: boolean; askAgain?: boolean } = {},
  ) =>
    scheduledAskNow({
      now,
      schedule: UPSTREAM,
      boundaryPassed: extra.boundaryPassed ?? false,
      askAgain: extra.askAgain ?? false,
      attempts,
    });

  it("rides upstream's numbers: 3 attempts, 5 minutes apart", () => {
    expect(SCHEDULED_ATTEMPTS).toBe(3);
    expect(SCHEDULED_RETRY_SECONDS).toBe(300);
  });

  it("a failed run (offline at the boundary) is retried twice, five minutes apart, then waits for the next boundary", () => {
    expect(ask(t0, undefined, { boundaryPassed: true })).toBe(true);
    let a = attemptEnded(attemptStarted(undefined, t0, UPSTREAM), t0, true);
    expect(ask(t0 + 60, a)).toBe(false); // too soon
    expect(ask(t0 + 300, a)).toBe(true);
    a = attemptEnded(attemptStarted(a, t0 + 300, UPSTREAM), t0 + 300, true);
    expect(a.count).toBe(2);
    expect(ask(t0 + 600, a)).toBe(true);
    a = attemptEnded(attemptStarted(a, t0 + 600, UPSTREAM), t0 + 600, true);
    expect(a.count).toBe(3);
    expect(ask(t0 + 900, a)).toBe(false); // out of attempts
    expect(ask(t0 + 3 * 3600, a)).toBe(false);
    // The next boundary starts over.
    const next = t0 + 6 * 3600;
    expect(ask(next, a, { boundaryPassed: true })).toBe(true);
    expect(attemptStarted(a, next, UPSTREAM).count).toBe(1);
  });

  it("the five minutes count from the failed run's END, as upstream's sleep does", () => {
    // A run that fails four minutes in.
    const started = attemptStarted(undefined, t0, UPSTREAM);
    expect(ask(t0 + 300, started)).toBe(false); // still running: no retry
    const a = attemptEnded(started, t0 + 240, true);
    expect(ask(t0 + 300, a)).toBe(false); // a minute after it failed
    expect(ask(t0 + 539, a)).toBe(false);
    expect(ask(t0 + 540, a)).toBe(true);
  });

  it("a run that did not fail is not retried: it waits for the next boundary", () => {
    const a = attemptEnded(attemptStarted(undefined, t0, UPSTREAM), t0, false);
    expect(ask(t0 + 300, a)).toBe(false);
    expect(ask(t0 + 3600, a)).toBe(false);
  });

  it("an ask that met a run in flight asks again on the next tick", () => {
    expect(ask(t0 + 300, undefined, { askAgain: true })).toBe(true);
    expect(ask(t0 + 300, undefined)).toBe(false);
  });
});
