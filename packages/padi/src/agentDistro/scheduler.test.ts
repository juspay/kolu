/**
 * The update timer on a fake clock: it ticks when it starts, at every capped
 * look and when poked, and says whether a schedule boundary has passed (on
 * time, late, or across a sleep) — never while there is nothing to keep
 * current. Whether to ask between boundaries (a retry) and whether a run starts
 * is the policy's call (`./schedule`'s `scheduledAskNow`, upstream's due rule;
 * `download.test.ts`).
 */

import type { UpdaterSchedule } from "@kolu/agent-distro/schedule";
import { describe, expect, it } from "vitest";
import { MAX_WAIT_MS, startUpdateTimer } from "./scheduler.ts";

/** Upstream's schedule: every six hours from 02:00 UTC. */
const UPSTREAM: UpdaterSchedule = { periodSeconds: 21600, offsetSeconds: 7200 };
const at = (iso: string) => Date.parse(iso);

/** A wall clock and a one-shot timer queue under the test's control. */
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
    /** When the armed timer will fire, or `undefined` when none is armed. */
    armedFor: () => pending?.due,
    /** Run the armed timer: the wall clock reads `wall` when it fires (later
     *  than its due time after a sleep). */
    fire: (wall?: number) => {
      const p = pending;
      if (p === undefined) throw new Error("no timer armed");
      pending = undefined;
      now = wall ?? p.due;
      p.fn();
    },
    set: (t: number) => {
      now = t;
    },
  };
}

function start(opts: { clock: ReturnType<typeof fakeClock>; on?: boolean }) {
  let on = opts.on ?? true;
  const asks: number[] = [];
  const ticks: number[] = [];
  const timer = startUpdateTimer({
    schedule: () => (on ? UPSTREAM : undefined),
    onTick: (boundaryPassed) => {
      ticks.push(opts.clock.now());
      if (boundaryPassed) asks.push(opts.clock.now());
    },
    now: opts.clock.now,
    setTimer: opts.clock.setTimer,
  });
  return {
    asks,
    ticks,
    timer,
    turn: (next: boolean) => {
      on = next;
    },
  };
}

describe("startUpdateTimer", () => {
  it("asks once at boot, then waits for the boundary in capped steps", () => {
    const clock = fakeClock(at("2026-10-08T07:00:00Z"));
    const { asks, ticks } = start({ clock });
    expect(asks).toEqual([at("2026-10-08T07:00:00Z")]);
    // Capped: the next look is MAX_WAIT_MS away, not an hour.
    expect(clock.armedFor()).toBe(at("2026-10-08T07:00:00Z") + MAX_WAIT_MS);
    // Looks before the boundary do not ask.
    while ((clock.armedFor() ?? 0) < at("2026-10-08T08:00:00Z")) clock.fire();
    expect(asks).toHaveLength(1);
    // …but every look still ticks, so the policy can retry between boundaries.
    expect(ticks.length).toBeGreaterThan(1);
    // The look that lands on the boundary asks.
    expect(clock.armedFor()).toBe(at("2026-10-08T08:00:00Z"));
    clock.fire();
    expect(asks).toEqual([
      at("2026-10-08T07:00:00Z"),
      at("2026-10-08T08:00:00Z"),
    ]);
  });

  it("a late fire after a sleep across boundaries asks ONCE", () => {
    const clock = fakeClock(at("2026-10-08T07:58:00Z"));
    const { asks } = start({ clock });
    // The machine sleeps; the timer due at 08:00 fires on waking at 15:30.
    clock.fire(at("2026-10-08T15:30:00Z"));
    expect(asks).toEqual([
      at("2026-10-08T07:58:00Z"),
      at("2026-10-08T15:30:00Z"),
    ]);
    // The next look, minutes later, does not ask again before 20:00.
    clock.fire();
    expect(asks).toHaveLength(2);
  });

  it("is idle while there is nothing to keep current, and a poke starts it", () => {
    const clock = fakeClock(at("2026-10-08T07:00:00Z"));
    const t = start({ clock, on: false });
    expect(t.asks).toEqual([]);
    expect(clock.armedFor()).toBeUndefined();
    t.turn(true);
    clock.set(at("2026-10-08T07:10:00Z"));
    t.timer.poke();
    expect(t.asks).toEqual([at("2026-10-08T07:10:00Z")]);
    expect(clock.armedFor()).toBeDefined();
    // Turned off again: the armed look finds nothing to do and re-arms nothing.
    t.turn(false);
    clock.fire();
    expect(t.asks).toHaveLength(1);
    expect(clock.armedFor()).toBeUndefined();
  });

  it("stop() ends it", () => {
    const clock = fakeClock(at("2026-10-08T07:00:00Z"));
    const t = start({ clock });
    t.timer.stop();
    expect(clock.armedFor()).toBeUndefined();
    t.timer.poke();
    expect(t.asks).toHaveLength(1);
  });

  it("keeps its cadence when the policy's tick throws", () => {
    const clock = fakeClock(at("2026-10-08T07:59:00Z"));
    let calls = 0;
    startUpdateTimer({
      schedule: () => UPSTREAM,
      onTick: () => {
        calls++;
        throw new Error("boom");
      },
      now: clock.now,
      setTimer: clock.setTimer,
    });
    clock.fire();
    expect(calls).toBe(2);
    expect(clock.armedFor()).toBeDefined();
  });
});
