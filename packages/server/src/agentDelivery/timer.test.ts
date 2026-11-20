import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import { describe, expect, it } from "vitest";
import {
  boundaryAtOrBefore,
  nextBoundary,
  startUpdateTimer,
  SUSPEND_SAFE_LOOK_MS,
} from "./timer.ts";

const UPSTREAM: UpdaterSchedule = { periodSeconds: 21600, offsetSeconds: 7200 };
const at = (iso: string) => Date.parse(iso);

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
    expect(clock.armedFor()).toBe(
      at("2026-10-08T07:00:00Z") + SUSPEND_SAFE_LOOK_MS,
    );
    while ((clock.armedFor() ?? 0) < at("2026-10-08T08:00:00Z")) clock.fire();
    expect(asks).toHaveLength(1);
    expect(ticks.length).toBeGreaterThan(1);
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
    clock.fire(at("2026-10-08T15:30:00Z"));
    expect(asks).toEqual([
      at("2026-10-08T07:58:00Z"),
      at("2026-10-08T15:30:00Z"),
    ]);
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
    t.turn(false);
    clock.fire();
    expect(t.asks).toHaveLength(1);
    expect(clock.armedFor()).toBeUndefined();
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

describe("boundaries — 02/08/14/20 UTC", () => {
  const s = (iso: string) => at(iso) / 1000;

  it("nextBoundary lands on upstream's four hours, strictly after now", () => {
    expect(nextBoundary(s("2026-10-08T00:30:00Z"), UPSTREAM)).toBe(
      s("2026-10-08T02:00:00Z"),
    );
    expect(nextBoundary(s("2026-10-08T02:00:00Z"), UPSTREAM)).toBe(
      s("2026-10-08T08:00:00Z"),
    );
    expect(nextBoundary(s("2026-10-08T13:59:59Z"), UPSTREAM)).toBe(
      s("2026-10-08T14:00:00Z"),
    );
    expect(nextBoundary(s("2026-10-08T21:00:00Z"), UPSTREAM)).toBe(
      s("2026-10-09T02:00:00Z"),
    );
  });

  it("boundaryAtOrBefore is the latest boundary not after now", () => {
    expect(boundaryAtOrBefore(s("2026-10-08T08:00:00Z"), UPSTREAM)).toBe(
      s("2026-10-08T08:00:00Z"),
    );
    expect(boundaryAtOrBefore(s("2026-10-08T13:59:59Z"), UPSTREAM)).toBe(
      s("2026-10-08T08:00:00Z"),
    );
    expect(boundaryAtOrBefore(s("2026-10-08T01:00:00Z"), UPSTREAM)).toBe(
      s("2026-10-07T20:00:00Z"),
    );
  });
});
