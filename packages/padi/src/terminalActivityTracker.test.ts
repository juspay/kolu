/**
 * The shared live-output tracker — the timer machinery both `liveActivity` (the
 * `activity` stream) and `finishGate` (the effective-finish debounce) stand on.
 * Pins the lifecycle (join on output, leave after the idle window), the sorted
 * `snapshot()` wire frame, and the `sameActivitySet` dedup.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createActivityTracker,
  sameActivitySet,
} from "./terminalActivityTracker.ts";

const IDLE = 100;
const A = "trk-a" as TerminalId;
const B = "trk-b" as TerminalId;

describe("createActivityTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lights on output and expires after the idle window, notifying on each edge", () => {
    const tracker = createActivityTracker(IDLE);
    const changes = vi.fn();
    tracker.onChange(changes);

    tracker.noteOutput(A);
    expect(tracker.isLive(A)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1); // static → live

    vi.advanceTimersByTime(IDLE - 1);
    expect(tracker.isLive(A)).toBe(true); // still within window
    vi.advanceTimersByTime(1);
    expect(tracker.isLive(A)).toBe(false); // window elapsed
    expect(changes).toHaveBeenCalledTimes(2); // live → static
    tracker.dispose();
  });

  it("re-arms the window on each chunk (no mid-stream expiry)", () => {
    const tracker = createActivityTracker(IDLE);
    tracker.noteOutput(A);
    vi.advanceTimersByTime(IDLE - 1);
    tracker.noteOutput(A); // fresh chunk resets the timer
    vi.advanceTimersByTime(IDLE - 1);
    expect(tracker.isLive(A)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tracker.isLive(A)).toBe(false);
    tracker.dispose();
  });

  it("snapshot() is sorted and forget() drops an id immediately", () => {
    const tracker = createActivityTracker(IDLE);
    tracker.noteOutput(B);
    tracker.noteOutput(A);
    expect(tracker.snapshot()).toEqual([A, B]); // sorted, not insertion order

    tracker.forget(A);
    expect(tracker.isLive(A)).toBe(false);
    expect(tracker.snapshot()).toEqual([B]);
    tracker.dispose();
  });
});

describe("sameActivitySet", () => {
  it("compares sorted frames element-wise", () => {
    expect(sameActivitySet([A, B], [A, B])).toBe(true);
    expect(sameActivitySet([A], [A, B])).toBe(false);
    expect(sameActivitySet([A, B], [B, A])).toBe(false); // order-sensitive by design
  });
});
