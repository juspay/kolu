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
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGridPublisher, GRID_SETTLE_MS } from "./publishGrid";
import { createShownPane } from "./shownPane";

function harness(init?: { grid?: TerminalGrid | null; visible?: boolean }) {
  let grid: TerminalGrid | null =
    init && "grid" in init ? (init.grid ?? null) : null;
  let visible = init?.visible ?? false;
  /** Is the view in front — false while the Conductor covers the canvas. */
  let inFront = true;
  /** The grid each attach ASSERTED — the pane's `resizeTo`, read at open. */
  const attachedAt: (TerminalGrid | null)[] = [];
  const published: TerminalGrid[] = [];
  let detaches = 0;
  /** Pending publishes dropped — what hiding costs a half-stated grid. */
  let cancels = 0;
  const pane = createShownPane({
    attach: () => attachedAt.push(grid),
    detach: () => {
      detaches += 1;
    },
    publish: (g) => published.push(g),
    cancelPublish: () => {
      cancels += 1;
    },
    restateOwed: () => {},
  });
  /** What `Terminal.tsx`'s effect compute hands the gate. */
  const facts = () => ({
    shown: grid !== null && visible,
    viewShown: inFront,
  });
  return {
    /** The pane measured its box (a first fit, a re-fit, a disposal). */
    measure(next: TerminalGrid | null) {
      grid = next;
      pane.observe(facts());
      if (next) pane.measured(next, facts());
    },
    /** The tile became the active one, or stopped being it. */
    show(next: boolean) {
      visible = next;
      pane.observe(facts());
    },
    pane,
    facts,
    /** Re-ask the gate with the facts unchanged. */
    observe() {
      pane.observe(facts());
    },
    attachedAt,
    /** The Conductor came in front of this pane's view, or left. */
    front(next: boolean) {
      inFront = next;
      pane.observe(facts());
    },
    published,
    detaches: () => detaches,
    cancels: () => cancels,
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

  it("hiding CANCELS a publish that has not landed yet", () => {
    // `measured` reads `shown()` the moment the grid moves, but the publish it
    // states waits out a settle window (`publishGrid.ts`, 250ms) — so a pane
    // hidden inside that window would resize a shared PTY a quarter second
    // after it stopped being readable, which is the exact cost this gate
    // exists to refuse. Nothing is lost: the reveal's attach carries the grid
    // in its own `resizeTo`.
    const h = harness({ visible: true });
    h.measure({ cols: 132, rows: 43 });
    expect(h.published).toEqual([{ cols: 132, rows: 43 }]);
    expect(h.cancels()).toBe(0);
    h.show(false);
    expect(h.cancels()).toBe(1);
    // …and the reveal cancels nothing — it STATES a grid, through the attach.
    h.show(true);
    expect(h.cancels()).toBe(1);
  });

  it("acts on CHANGES only, however often it is asked", () => {
    // Both facts are live signals — the grid ticks on every re-fit — so the
    // pane's effects re-run far more often than the answer moves. A gate that
    // re-attached on each tick would churn the PTY harder than the bug it
    // replaces.
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    for (let i = 0; i < 5; i++) h.observe();
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

describe("the shown-pane gate, under the Conductor", () => {
  it("publishes no new measurement while the Conductor is in front, and stays attached", () => {
    // The window is resized while the Conductor covers the canvas: the tile
    // under it re-measures, and must not size a terminal a pane is sizing.
    const h = harness({ visible: true });
    h.measure({ cols: 120, rows: 40 });
    h.front(false);
    h.measure({ cols: 132, rows: 43 });
    expect(h.published).toEqual([{ cols: 120, rows: 40 }]);
    expect(h.detaches()).toBe(0);
  });

  it("drops a measurement still settling when the Conductor comes in front", () => {
    const h = harness({ visible: true });
    h.measure({ cols: 120, rows: 40 });
    const before = h.cancels();
    h.front(false);
    expect(h.cancels()).toBe(before + 1);
  });

  it("publishes again once the canvas is back in front", () => {
    const h = harness({ visible: true });
    h.measure({ cols: 120, rows: 40 });
    h.front(false);
    h.front(true);
    h.measure({ cols: 132, rows: 43 });
    expect(h.published).toEqual([
      { cols: 120, rows: 40 },
      { cols: 132, rows: 43 },
    ]);
  });
});

describe("a grid owed from a host outage, under the Conductor", () => {
  // The REAL publisher behind the gate, as `Terminal.tsx` binds it: its latch
  // holds a grid a not-connected window dropped, and the gate decides when it
  // may be restated.
  function owing() {
    let host = "warming";
    let inFront = true;
    const resized: TerminalGrid[] = [];
    const publisher = createGridPublisher({
      terminalId: "t",
      hostState: () => host,
      ptyLive: () => true,
      resize: (grid) => Effect.sync(() => resized.push(grid)),
      run: (action) => Effect.runSync(action),
    });
    const pane = createShownPane({
      attach: () => {},
      detach: () => {},
      publish: publisher.publish,
      cancelPublish: publisher.cancel,
      restateOwed: publisher.republishSuppressed,
    });
    const facts = () => ({ shown: true, viewShown: inFront });
    pane.observe(facts());
    // Measured while the host was down: the publish is dropped and latched.
    pane.measured({ cols: 120, rows: 40 }, facts());
    vi.advanceTimersByTime(GRID_SETTLE_MS);
    return {
      resized,
      /** The host's state changed; `Terminal.tsx` re-observes the gate. */
      host(next: string) {
        host = next;
        pane.observe(facts());
      },
      front(next: boolean) {
        inFront = next;
        pane.observe(facts());
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restates nothing when the host comes back behind the Conductor", () => {
    const o = owing();
    o.front(false);
    o.host("connected");
    expect(o.resized).toEqual([]);
  });

  it("restates the owed grid once, back in front with the host connected", () => {
    const o = owing();
    o.front(false);
    o.host("connected");
    o.front(true);
    o.host("connected");
    expect(o.resized).toEqual([{ cols: 120, rows: 40 }]);
  });

  it("restates on the host coming back while in front, as before", () => {
    const o = owing();
    o.host("connected");
    expect(o.resized).toEqual([{ cols: 120, rows: 40 }]);
  });
});
