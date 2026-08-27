/**
 * The foreign-grid watcher's ONE judgment: is this mismatch someone else, or my
 * own resize still in flight?
 *
 * Both look identical at the instant the record moves — the pane's grid and the
 * record's disagree — and the two demand opposite responses: re-attach (which
 * resets the screen and re-asserts our size) versus do nothing at all. Getting
 * it wrong in either direction is a real defect, so both directions are pinned:
 * a drag that walks the record through six intermediate grids must cost zero
 * re-attaches, and a viewer that takes the terminal and keeps it must cost
 * exactly one.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForeignGridWatcher } from "./foreignGrid";

const SETTLE = 750;

function harness(init?: {
  served?: TerminalGrid | null;
  mine?: TerminalGrid | null;
  host?: string;
}) {
  let served: TerminalGrid | null = init?.served ?? null;
  // `??` would turn an explicitly-null `mine` back into the default, and "the
  // pane has not measured" is one of the cases under test.
  let mine: TerminalGrid | null =
    init && "mine" in init ? (init.mine ?? null) : { cols: 120, rows: 40 };
  let host = init?.host ?? "connected";
  let reopens = 0;
  const watcher = createForeignGridWatcher({
    served: () => served ?? undefined,
    mine: () => mine,
    hostState: () => host,
    reopen: () => {
      reopens += 1;
    },
    settleMs: SETTLE,
  });
  return {
    watcher,
    /** The record published a new grid — the only thing that drives `observe`. */
    record(grid: TerminalGrid | null) {
      served = grid;
      watcher.observe();
    },
    /** This pane measured a new box (a drag, a reveal, a disposal). */
    measure(grid: TerminalGrid | null) {
      mine = grid;
    },
    disconnect() {
      host = "warming";
    },
    reopens: () => reopens,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the foreign-grid watcher", () => {
  it("re-attaches once when another viewer takes the terminal and keeps it", () => {
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 65, rows: 40 });
    // Nothing yet — a verdict this early cannot tell a foreign resize from our
    // own round trip.
    expect(h.reopens()).toBe(0);
    vi.advanceTimersByTime(SETTLE);
    expect(h.reopens()).toBe(1);
  });

  it("stays silent through OUR OWN resize, however many steps it takes", () => {
    // The drag: the pane measures each intermediate box and the record trails a
    // round trip behind, so every one of these ticks is a live mismatch. Acting
    // on any of them would reset the user's screen mid-drag.
    const h = harness({ mine: { cols: 120, rows: 40 } });
    for (const cols of [110, 100, 90, 80, 70, 65]) {
      h.measure({ cols, rows: 40 });
      h.record({ cols: cols + 10, rows: 40 });
      vi.advanceTimersByTime(100);
    }
    // …and the record finally arrives where the pane already is.
    h.record({ cols: 65, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(h.reopens()).toBe(0);
  });

  it("drops a pending verdict when the mismatch resolves on its own", () => {
    // The single-step form of the case above, and the reason `observe` cancels
    // before it re-arms rather than only when it arms.
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 80, rows: 24 });
    vi.advanceTimersByTime(SETTLE - 50);
    h.record({ cols: 120, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(h.reopens()).toBe(0);
  });

  it("re-reads the pane's grid too — a pane that moved TO the served size is fine", () => {
    // The record never moves again here: what resolves the mismatch is this
    // pane's own re-measure. The verdict has to re-read BOTH facts, not just
    // the one that armed it.
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 80, rows: 24 });
    h.measure({ cols: 80, rows: 24 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(h.reopens()).toBe(0);
  });

  it("sits out a mismatch while the host is not connected", () => {
    // Our own publishes are suppressed while the host is down, so the record
    // legitimately holds a grid we never got to restate. Re-attaching would
    // churn against a host that cannot answer.
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.disconnect();
    h.record({ cols: 65, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 4);
    expect(h.reopens()).toBe(0);
  });

  it("says nothing when either side has no grid to state", () => {
    // An older padi serves no grid, and an unmeasured or disposed pane has none
    // to compare. Acting on ignorance would spin the re-attach loop against a
    // pane with nothing to ask for.
    const noRecord = harness({ mine: { cols: 120, rows: 40 } });
    noRecord.record(null);
    vi.advanceTimersByTime(SETTLE * 2);
    expect(noRecord.reopens()).toBe(0);

    const noPane = harness({ mine: null });
    noPane.record({ cols: 65, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(noPane.reopens()).toBe(0);
  });

  it("catches a rows-only change", () => {
    // A horizontal divider drag by another viewer reflows nothing, but this
    // pane still renders rows the pty does not have.
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 120, rows: 24 });
    vi.advanceTimersByTime(SETTLE);
    expect(h.reopens()).toBe(1);
  });

  it("fires nothing after dispose", () => {
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 65, rows: 40 });
    h.watcher.dispose();
    vi.advanceTimersByTime(SETTLE * 4);
    expect(h.reopens()).toBe(0);
  });
});
