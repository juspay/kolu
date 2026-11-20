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
    record(grid: TerminalGrid | null) {
      served = grid;
      watcher.observe();
    },
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
    expect(h.reopens()).toBe(0);
    vi.advanceTimersByTime(SETTLE);
    expect(h.reopens()).toBe(1);
  });

  it("stays silent through OUR OWN resize, however many steps it takes", () => {
    const h = harness({ mine: { cols: 120, rows: 40 } });
    for (const cols of [110, 100, 90, 80, 70, 65]) {
      h.measure({ cols, rows: 40 });
      h.record({ cols: cols + 10, rows: 40 });
      vi.advanceTimersByTime(100);
    }
    h.record({ cols: 65, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(h.reopens()).toBe(0);
  });

  it("drops a pending verdict when the mismatch resolves on its own", () => {
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 80, rows: 24 });
    vi.advanceTimersByTime(SETTLE - 50);
    h.record({ cols: 120, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(h.reopens()).toBe(0);
  });

  it("re-reads the pane's grid too — a pane that moved TO the served size is fine", () => {
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.record({ cols: 80, rows: 24 });
    h.measure({ cols: 80, rows: 24 });
    vi.advanceTimersByTime(SETTLE * 2);
    expect(h.reopens()).toBe(0);
  });

  it("sits out a mismatch while the host is not connected", () => {
    const h = harness({ mine: { cols: 120, rows: 40 } });
    h.disconnect();
    h.record({ cols: 65, rows: 40 });
    vi.advanceTimersByTime(SETTLE * 4);
    expect(h.reopens()).toBe(0);
  });

  it("says nothing when either side has no grid to state", () => {
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
