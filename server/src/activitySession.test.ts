import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createActivitySession,
  type SessionEndEvent,
  type ActivitySessionTracker,
} from "./activitySession.ts";

describe("ActivitySessionTracker", () => {
  let clock: number;
  let events: SessionEndEvent[];
  let tracker: ActivitySessionTracker;

  function advance(ms: number) {
    clock += ms;
  }

  function createTracker(gracePeriodMs = 30_000) {
    return createActivitySession({
      gracePeriodMs,
      onSessionEnd: (e) => events.push(e),
      now: () => clock,
    });
  }

  beforeEach(() => {
    clock = 1000;
    events = [];
    tracker = createTracker();
  });

  afterEach(() => {
    tracker.dispose();
  });

  it("emits session end after grace period expires", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    tracker.touch();
    advance(60_000);
    tracker.touch(); // last activity at 61s

    // Grace period hasn't elapsed yet
    t.mock.timers.tick(29_999);
    assert.equal(events.length, 0);

    // Grace period expires
    t.mock.timers.tick(1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 60); // 61000 - 1000 = 60s
  });

  it("coalesces activity bursts within grace period", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    // First burst
    tracker.touch(); // session starts at t=1000
    advance(5_000);
    tracker.touch();

    // Gap of 20s (within 30s grace)
    advance(20_000);
    tracker.touch(); // activity resumes at t=26000

    advance(10_000);
    tracker.touch(); // last activity at t=36000

    // No event yet — grace timer reset
    t.mock.timers.tick(29_999);
    assert.equal(events.length, 0);

    // Grace expires
    t.mock.timers.tick(1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 35); // 36000 - 1000 = 35s
  });

  it("does not emit if disposed before grace period", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    tracker.touch();
    advance(10_000);
    tracker.touch();

    tracker.dispose();
    t.mock.timers.tick(60_000);
    assert.equal(events.length, 0);
  });

  it("starts a new session after a previous one ends", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    // First session
    tracker.touch(); // t=1000
    advance(10_000);
    tracker.touch(); // t=11000

    t.mock.timers.tick(30_000); // grace expires
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 10);

    // Second session
    advance(5_000);
    tracker.touch(); // t=16000
    advance(20_000);
    tracker.touch(); // t=36000

    t.mock.timers.tick(30_000);
    assert.equal(events.length, 2);
    assert.equal(events[1]!.durationS, 20);
  });

  it("handles single touch (zero duration session)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    tracker.touch();
    t.mock.timers.tick(30_000);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 0);
  });

  it("respects custom grace period", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    tracker.dispose();

    tracker = createTracker(5_000); // 5s grace
    tracker.touch();
    advance(3_000);
    tracker.touch();

    t.mock.timers.tick(4_999);
    assert.equal(events.length, 0);

    t.mock.timers.tick(1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 3);
  });
});
