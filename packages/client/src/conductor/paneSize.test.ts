/**
 * A desktop live pane sets its terminal's size — on two occasions only: when
 * it comes on screen measured, and when the grid it would ask for changes.
 * Everything else it sees must leave the terminal alone. And the grid it asks
 * for is the most its body holds, never below 80×24.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { describe, expect, it } from "vitest";
import { createPaneSize, paneGrid } from "./paneSize";

function harness(init?: { desktop?: boolean }) {
  let connected = false;
  let desktop = init?.desktop ?? true;
  let asked: TerminalGrid | null = null;
  const published: TerminalGrid[] = [];
  let cancels = 0;
  let restates = 0;
  const pane = createPaneSize({
    publish: (g) => published.push(g),
    cancelPublish: () => {
      cancels += 1;
    },
    restateOwed: () => {
      restates += 1;
    },
  });
  const observe = () => pane.observe({ connected, desktop, asked });
  return {
    /** The pane came on screen, or left it. */
    connect(next: boolean) {
      connected = next;
      observe();
    },
    /** The pane measured the grid it would ask for. */
    ask(next: TerminalGrid | null) {
      asked = next;
      observe();
    },
    layout(isDesktop: boolean) {
      desktop = isDesktop;
      observe();
    },
    /** Anything else that re-runs the pane's effect: a re-attach of its
     *  screen, someone else's resize, the scroll lock. None changes a fact
     *  the policy reads. */
    poke() {
      observe();
    },
    published,
    cancels: () => cancels,
    restates: () => restates,
  };
}

const BIG = { cols: 145, rows: 50 };

describe("a desktop live pane setting its terminal's size", () => {
  it("speaks once when it comes on screen measured", () => {
    const h = harness();
    h.ask(BIG);
    expect(h.published).toEqual([]);
    h.connect(true);
    expect(h.published).toEqual([BIG]);
  });

  it("speaks once per change of the grid it would ask for", () => {
    const h = harness();
    h.connect(true);
    h.ask(BIG);
    h.ask({ cols: 145, rows: 24 });
    expect(h.published).toEqual([BIG, { cols: 145, rows: 24 }]);
  });

  it("says nothing for an unchanged grid", () => {
    const h = harness();
    h.connect(true);
    h.ask(BIG);
    h.ask({ ...BIG });
    expect(h.published).toEqual([BIG]);
  });

  it("says nothing on a phone or a tablet", () => {
    const h = harness({ desktop: false });
    h.connect(true);
    h.ask(BIG);
    h.ask({ cols: 90, rows: 30 });
    expect(h.published).toEqual([]);
  });

  it("says nothing while not connected", () => {
    const h = harness();
    h.ask(BIG);
    h.ask({ cols: 90, rows: 30 });
    expect(h.published).toEqual([]);
  });

  it("drops a pending publish when the pane leaves the screen", () => {
    const h = harness();
    h.connect(true);
    h.ask(BIG);
    h.connect(false);
    expect(h.cancels()).toBe(1);
  });

  it("says nothing on a foreign resize, a re-attach or the scroll lock", () => {
    const h = harness();
    h.connect(true);
    h.ask(BIG);
    h.poke();
    h.poke();
    expect(h.published).toEqual([BIG]);
  });

  it("speaks once again when it comes back on screen", () => {
    const h = harness();
    h.connect(true);
    h.ask(BIG);
    h.connect(false);
    h.connect(true);
    expect(h.published).toEqual([BIG, BIG]);
  });
});

describe("a live pane's owed grid", () => {
  it("is restated only while the pane is on screen, on a phone as on a desktop", () => {
    const h = harness({ desktop: false });
    h.poke();
    expect(h.restates()).toBe(0);
    h.connect(true);
    expect(h.restates()).toBe(1);
    h.connect(false);
    h.poke();
    expect(h.restates()).toBe(1);
  });
});

describe("paneGrid", () => {
  // A 14-point cell of 8.4×17 px inside 26 px of padding across, 12 down.
  const measured = {
    cell: { width: 8.4, height: 17 },
    pad: { x: 26, y: 12 },
    fontSize: 14,
    fit: true,
  };

  it("asks for every column and row the body holds", () => {
    // (1374 − 26) / 8.4 = 160.5 columns; (900 − 12) / 17 = 52.2 rows.
    expect(paneGrid({ ...measured, width: 1374, height: 900 })).toEqual({
      cols: 160,
      rows: 52,
    });
  });

  it("asks for no fewer than 80 columns, keeping the rows it holds", () => {
    // 474 / 8.4 = 56 columns of room.
    expect(
      paneGrid({ ...measured, fit: false, width: 500, height: 900 }),
    ).toEqual({ cols: 80, rows: 52 });
  });

  it("asks for no fewer than 24 rows, keeping the columns it holds", () => {
    // 288 / 17 = 16 rows of room.
    expect(paneGrid({ ...measured, width: 1374, height: 300 })).toEqual({
      cols: 160,
      rows: 24,
    });
  });

  it("counts the rows at the font Fit width shrinks 80 columns to", () => {
    // 80 columns in 500 px shrink 14 points to 9: an 11 px row (10.9 rounded
    // up, as the renderer rounds it), so 408 px hold 37 rows where the
    // 14-point font held 24.
    const body = { width: 500, height: 420 };
    expect(paneGrid({ ...measured, ...body })).toEqual({ cols: 80, rows: 37 });
    expect(paneGrid({ ...measured, ...body, fit: false })).toEqual({
      cols: 80,
      rows: 24,
    });
  });

  it("rounds the shrunk font's row up, so it never asks for a row that does not fit", () => {
    // 416 px over the unrounded 10.93 px row is 38 rows, but 38 rows of the
    // 11 px row the renderer draws need 418 px: the top row would be cut.
    expect(paneGrid({ ...measured, width: 500, height: 428 })).toEqual({
      cols: 80,
      rows: 37,
    });
  });

  it("asks for nothing until the pane has measured", () => {
    const body = { width: 1374, height: 900 };
    expect(paneGrid({ ...measured, ...body, cell: null })).toBeNull();
    expect(paneGrid({ ...measured, ...body, pad: null })).toBeNull();
    expect(paneGrid({ ...measured, width: 0, height: 900 })).toBeNull();
  });
});
