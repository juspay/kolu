/**
 * The gate on a pane's one write: attaching, which resizes the shared PTY.
 *
 * Opening kolu on a phone used to attach every terminal of the host at once —
 * `MobileTileView` mounts a body for each and hides the inactive ones, and a
 * hidden box still measures, so the measured-only gate fired for all of them.
 * 14 PTYs resized in under a second, 14 agents repainting, to serialize screens
 * nobody could see (kolu#2362 §4). Both directions are pinned here: a hidden
 * pane must cost nothing at all, and a revealed one must attach at the size it
 * measured while it was hidden.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { describe, expect, it } from "vitest";
import { createShownPane } from "./shownPane";

function harness(init?: { grid?: TerminalGrid | null; visible?: boolean }) {
  let grid: TerminalGrid | null =
    init && "grid" in init ? (init.grid ?? null) : null;
  let visible = init?.visible ?? false;
  /** The grid each attach ASSERTED — the pane's `resizeTo`, read at open. */
  const attachedAt: (TerminalGrid | null)[] = [];
  const published: TerminalGrid[] = [];
  let detaches = 0;
  const pane = createShownPane({
    shown: () => grid !== null && visible,
    attach: () => attachedAt.push(grid),
    detach: () => {
      detaches += 1;
    },
    publish: (g) => published.push(g),
  });
  return {
    /** The pane measured its box (a first fit, a re-fit, a disposal). */
    measure(next: TerminalGrid | null) {
      grid = next;
      pane.observe();
      if (next) pane.measured(next);
    },
    /** The tile became the active one, or stopped being it. */
    show(next: boolean) {
      visible = next;
      pane.observe();
    },
    pane,
    attachedAt,
    published,
    detaches: () => detaches,
  };
}

describe("the shown-pane gate", () => {
  it("a measured but hidden pane attaches nothing and publishes nothing", () => {
    // Every background mobile tile and every background sub-tab: a real box,
    // a real measurement, and no reason to touch the terminal at all.
    const h = harness({ visible: false });
    h.measure({ cols: 80, rows: 24 });
    h.measure({ cols: 132, rows: 43 });
    expect(h.attachedAt).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it("a visible pane that has not measured attaches nothing", () => {
    // xterm reports its invented 80×24 until the pane measures, and a snapshot
    // asked for at an invented grid is bytes laid out for a width the pane does
    // not have. No grid, no bytes — the rule the measured gate always had.
    const h = harness({ visible: true });
    expect(h.attachedAt).toEqual([]);
    h.measure({ cols: 100, rows: 30 });
    expect(h.attachedAt).toEqual([{ cols: 100, rows: 30 }]);
  });

  it("the reveal attaches at the grid the pane measured while hidden", () => {
    // The size measured while hidden is not lost and does not need publishing:
    // the attach's own `resizeTo` asserts it.
    const h = harness({ visible: false });
    h.measure({ cols: 132, rows: 43 });
    expect(h.published).toEqual([]);
    h.show(true);
    expect(h.attachedAt).toEqual([{ cols: 132, rows: 43 }]);
  });

  it("hiding ENDS the attach, and showing again opens exactly one more", () => {
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    h.show(false);
    expect(h.detaches()).toBe(1);
    h.show(true);
    expect(h.attachedAt).toHaveLength(2);
    expect(h.detaches()).toBe(1);
  });

  it("publishes a re-fit only while the pane is shown", () => {
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    h.measure({ cols: 90, rows: 24 });
    expect(h.published).toEqual([
      { cols: 80, rows: 24 },
      { cols: 90, rows: 24 },
    ]);
    h.show(false);
    h.measure({ cols: 120, rows: 40 });
    expect(h.published).toHaveLength(2);
  });

  it("acts on CHANGES only, however often it is asked", () => {
    // Both facts are live signals — the grid ticks on every re-fit — so the
    // pane's effects re-run far more often than the answer moves. A gate that
    // re-attached on each tick would churn the PTY harder than the bug it
    // replaces.
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    for (let i = 0; i < 5; i++) h.pane.observe();
    expect(h.attachedAt).toHaveLength(1);
    h.show(true);
    expect(h.attachedAt).toHaveLength(1);
    expect(h.detaches()).toBe(0);
  });

  it("a pane that loses its measurement detaches", () => {
    // Disposal releases the grid; nothing may keep painting into it.
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    h.measure(null);
    expect(h.detaches()).toBe(1);
  });
});
