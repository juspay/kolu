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
    tracker.touch(); // last activity at t=61000

    t.mock.timers.tick(29_999);
    assert.equal(events.length, 0);

    t.mock.timers.tick(1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 60);
    assert.equal(events[0]!.lastActivityAt, 61_000);
  });

  it("coalesces activity bursts within grace period", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    tracker.touch(); // t=1000
    advance(5_000);
    tracker.touch(); // t=6000

    advance(20_000);
    tracker.touch(); // t=26000

    advance(10_000);
    tracker.touch(); // t=36000

    t.mock.timers.tick(29_999);
    assert.equal(events.length, 0);

    t.mock.timers.tick(1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 35);
    assert.equal(events[0]!.lastActivityAt, 36_000);
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

    t.mock.timers.tick(30_000);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 10);
    assert.equal(events[0]!.lastActivityAt, 11_000);

    // Second session
    advance(5_000);
    tracker.touch(); // t=16000
    advance(20_000);
    tracker.touch(); // t=36000

    t.mock.timers.tick(30_000);
    assert.equal(events.length, 2);
    assert.equal(events[1]!.durationS, 20);
    assert.equal(events[1]!.lastActivityAt, 36_000);
  });

  it("handles single touch (zero duration session)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    tracker.touch(); // t=1000
    t.mock.timers.tick(30_000);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 0);
    assert.equal(events[0]!.lastActivityAt, 1000);
  });

  it("respects custom grace period", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    tracker.dispose();

    tracker = createTracker(5_000);
    tracker.touch(); // t=1000
    advance(3_000);
    tracker.touch(); // t=4000

    t.mock.timers.tick(4_999);
    assert.equal(events.length, 0);

    t.mock.timers.tick(1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.durationS, 3);
    assert.equal(events[0]!.lastActivityAt, 4000);
  });

  it("lastActivityAt lets client detect if user saw the activity", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    // Simulate: user watches terminal, activity happens, user leaves, grace fires
    tracker.touch(); // t=1000 — user is watching
    advance(2_000);
    tracker.touch(); // t=3000 — last activity while user watches
    // User leaves at t=3500 → leftAt=3500
    advance(500);
    const userLeftAt = clock; // 3500

    // Grace fires — client would check: leftAt(3500) >= lastActivityAt(3000) → seen → skip
    t.mock.timers.tick(30_000);
    assert.equal(events.length, 1);
    assert.ok(
      userLeftAt >= events[0]!.lastActivityAt,
      "User left after last activity — client should suppress this alert",
    );
  });

  it("lastActivityAt flags unseen activity when user left before it", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });

    tracker.touch(); // t=1000 — user is watching
    // User leaves at t=1500
    advance(500);
    const userLeftAt = clock; // 1500

    // New activity after user left
    advance(2_000);
    tracker.touch(); // t=3500 — user not watching

    // Grace fires — client: leftAt(1500) < lastActivityAt(3500) → unseen → alert!
    t.mock.timers.tick(30_000);
    assert.equal(events.length, 1);
    assert.ok(
      userLeftAt < events[0]!.lastActivityAt,
      "User left before last activity — client should show this alert",
    );
  });
});
