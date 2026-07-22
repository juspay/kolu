/**
 * The effective-finish gate as a PURE FOLD over two padi-local chronologies
 * (`enteredWaitingAt` from the agent-bucket edge, `lastMeaningfulArrivalAt` from
 * kaval's activity edge). Fake timers drive `Date.now` + the deadline wake, so the
 * fold's time-dependent decision is exercised deterministically:
 *   - a `waiting` terminal settles only after a full quiet window since it entered;
 *   - a meaningful-output edge resets the window (background sub-agents), and one
 *     after settling un-settles it;
 *   - with NO further edge a settled terminal STAYS settled — a resize produces no
 *     kaval edge, so "visiting un-finishes it" is structurally unspellable;
 *   - a fresh waiting episode earns a fresh window (no poll-missed inheritance);
 *   - an unstamped terminal is never finished (default-excluded).
 */

import { computed, derived } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishGate, type FinishGate } from "./finishGate.ts";

const QUIET = 200;
const RECONCILE = 50;
const A = "fin-a" as TerminalId;
const B = "fin-b" as TerminalId;

describe("createFinishGate (pure fold)", () => {
  let waiting: Set<TerminalId>;
  let observe: (id: TerminalId, isWaiting: boolean) => void;
  let activity: (id: TerminalId) => void;
  let gate: FinishGate;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    waiting = new Set();
    let observer: ((id: TerminalId, isWaiting: boolean) => void) | null = null;
    let activityCb: ((id: TerminalId) => void) | null = null;
    // Keep `listWaiting` in lockstep with the agent-bucket edge, exactly as
    // production does (commitSnapshot updates the registry snapshot, THEN publishes
    // the bucket edge — so the reconcile's registry read always agrees with it).
    observe = (id, isWaiting) => {
      if (isWaiting) waiting.add(id);
      else waiting.delete(id);
      observer?.(id, isWaiting);
    };
    activity = (id) => activityCb?.(id);
    gate = createFinishGate({
      quietMs: QUIET,
      reconcileMs: RECONCILE,
      listWaiting: () => new Set(waiting),
      subscribeAgentObservations: (cb) => {
        observer = cb;
        return () => {
          observer = null;
        };
      },
      subscribeActivity: (cb) => {
        activityCb = cb;
        return () => {
          activityCb = null;
        };
      },
    });
  });

  afterEach(() => {
    gate.dispose();
    vi.useRealTimers();
  });

  const settled = () => gate.settledFinished();

  it("settles a `waiting` terminal only after a full quiet window since it entered", () => {
    observe(A, true);
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(QUIET - 1);
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...settled()]).toEqual([A]);
  });

  it("a meaningful-output edge resets the window — a still-working terminal never settles early", () => {
    observe(A, true);
    vi.advanceTimersByTime(QUIET - 1);
    activity(A); // a byte lands (background sub-agent) — window restarts
    vi.advanceTimersByTime(QUIET - 1);
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...settled()]).toEqual([A]);
  });

  it("STAYS settled with no further edge — a resize produces no kaval edge (the regression, structurally gone)", () => {
    observe(A, true);
    vi.advanceTimersByTime(QUIET);
    expect(settled().has(A)).toBe(true);
    // Whatever the user does — reveal, resize, switch away — kaval emits no
    // meaningful-output edge, so nothing un-settles it.
    vi.advanceTimersByTime(QUIET * 5);
    expect([...settled()]).toEqual([A]);
  });

  it("resumed output un-settles a finished terminal, which re-settles after a fresh window", () => {
    observe(A, true);
    vi.advanceTimersByTime(QUIET);
    expect(settled().has(A)).toBe(true);
    activity(A); // background sub-agents resume
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(QUIET - 1);
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...settled()]).toEqual([A]);
  });

  it("drops a terminal from the settled set once it leaves `waiting`", () => {
    observe(A, true);
    vi.advanceTimersByTime(QUIET);
    expect(settled().has(A)).toBe(true);
    observe(A, false);
    expect(settled().has(A)).toBe(false);
  });

  it("a fresh waiting episode earns a fresh window (no inheritance across a leave/re-enter)", () => {
    observe(A, true);
    vi.advanceTimersByTime(QUIET);
    expect(settled().has(A)).toBe(true);
    observe(A, false); // working blip
    observe(A, true); // turn 2 — fresh stamp
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(QUIET - 1);
    expect(settled().has(A)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([...settled()]).toEqual([A]);
  });

  it("never finishes a terminal it never observed as waiting (default-excluded)", () => {
    vi.advanceTimersByTime(QUIET * 5);
    expect(settled().has(A)).toBe(false);
  });

  it("seeds an ALREADY-waiting terminal from the registry (boot/adopt the edge missed)", () => {
    waiting.add(A); // in the registry as waiting, but no transition edge fired
    vi.advanceTimersByTime(RECONCILE); // reconcile seeds enteredWaitingAt
    vi.advanceTimersByTime(QUIET);
    expect([...settled()]).toEqual([A]);
  });

  it("debounces each terminal independently", () => {
    observe(A, true);
    vi.advanceTimersByTime(QUIET); // A settles
    observe(B, true);
    const s = settled();
    expect(s.has(A)).toBe(true);
    expect(s.has(B)).toBe(false);
    vi.advanceTimersByTime(QUIET);
    expect([...settled()].sort()).toEqual([A, B]);
  });

  it("publishes NO transient finish when a terminal leaves waiting mid-window", () => {
    // The fold has no settle state machine, so leaving mid-window simply drops the
    // id — record EVERY emitted frame and assert A never appears.
    const frames: TerminalId[][] = [];
    const observed = derived.cell(computed(() => [...gate.settledFinished()]));
    const stop = observed.connect({
      set: (v) => frames.push(v as TerminalId[]),
    });

    observe(A, true);
    vi.advanceTimersByTime(QUIET / 2); // partway through the window
    observe(A, false); // leaves before settling
    expect(frames.every((f) => !f.includes(A))).toBe(true);
    expect(settled().has(A)).toBe(false);

    if (typeof stop === "function") stop();
  });
});
