/**
 * Unit tests for the live-output activity tracker — the debounce model behind
 * arivu's `activity` stream (the remote green dot). Pure: no daemon, no kaval.
 */

import type { TerminalId } from "@kolu/arivu-contract";
import { describe, expect, it } from "vitest";
import { createActivityTracker, sameActivitySet } from "./activity.ts";

const id = (s: string): TerminalId => s as TerminalId;
const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe("createActivityTracker", () => {
  it("lights a terminal on output, then clears it after the idle window", async () => {
    const t = createActivityTracker({ idleAfterMs: 20 });
    const changes: TerminalId[][] = [];
    t.onChange(() => changes.push(t.snapshot()));

    t.noteOutput(id("a"));
    expect(t.snapshot()).toEqual(["a"]); // live immediately
    await delay(40);
    expect(t.snapshot()).toEqual([]); // quiet again after the window
    expect(changes).toEqual([["a"], []]); // one change to light, one to clear
    t.dispose();
  });

  it("re-arms the idle timer on each chunk (stays live through sub-window gaps)", async () => {
    const t = createActivityTracker({ idleAfterMs: 30 });
    t.noteOutput(id("a"));
    await delay(20);
    t.noteOutput(id("a")); // before the window elapses → still live, timer reset
    await delay(20);
    expect(t.snapshot()).toEqual(["a"]); // 40ms since first chunk, but only 20ms since last
    await delay(25);
    expect(t.snapshot()).toEqual([]); // finally quiet
    t.dispose();
  });

  it("notifies once per live-set change, not per chunk", async () => {
    const t = createActivityTracker({ idleAfterMs: 50 });
    let count = 0;
    t.onChange(() => {
      count += 1;
    });
    t.noteOutput(id("a")); // change: {} → {a}
    t.noteOutput(id("a")); // no change: still {a}
    t.noteOutput(id("a"));
    expect(count).toBe(1);
    t.dispose();
  });

  it("forget drops a departed terminal immediately", () => {
    const t = createActivityTracker({ idleAfterMs: 1000 });
    t.noteOutput(id("a"));
    t.noteOutput(id("b"));
    expect(t.snapshot()).toEqual(["a", "b"]); // snapshot is sorted
    t.forget(id("a"));
    expect(t.snapshot()).toEqual(["b"]);
    t.dispose();
  });

  it("snapshot is sorted and sameActivitySet compares order-stably", () => {
    const t = createActivityTracker();
    t.noteOutput(id("b"));
    t.noteOutput(id("a"));
    expect(t.snapshot()).toEqual(["a", "b"]); // sorted regardless of insert order
    expect(sameActivitySet(["a", "b"] as TerminalId[], t.snapshot())).toBe(
      true,
    );
    expect(sameActivitySet(["a"] as TerminalId[], t.snapshot())).toBe(false);
    t.dispose();
  });
});
