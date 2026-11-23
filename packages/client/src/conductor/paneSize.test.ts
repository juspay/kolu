/**
 * A desktop live pane sets its terminal's size — on two occasions only: when
 * it comes on screen measured, and when the grid it would ask for changes.
 * Everything else it sees must leave the terminal alone.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { describe, expect, it } from "vitest";
import { createPaneSize } from "./paneSize";

function harness(init?: { desktop?: boolean }) {
  let connected = false;
  let desktop = init?.desktop ?? true;
  let asked: TerminalGrid | null = null;
  const published: TerminalGrid[] = [];
  let cancels = 0;
  const pane = createPaneSize({
    connected: () => connected,
    desktop: () => desktop,
    asked: () => asked,
    publish: (g) => published.push(g),
    cancelPublish: () => {
      cancels += 1;
    },
  });
  return {
    /** The pane came on screen, or left it. */
    connect(next: boolean) {
      connected = next;
      pane.observe();
    },
    /** The pane measured the grid it would ask for. */
    ask(next: TerminalGrid | null) {
      asked = next;
      pane.observe();
    },
    layout(isDesktop: boolean) {
      desktop = isDesktop;
      pane.observe();
    },
    /** Anything else that re-runs the pane's effect: a re-attach of its
     *  screen, someone else's resize, the scroll lock. None changes a fact
     *  the policy reads. */
    poke() {
      pane.observe();
    },
    published,
    cancels: () => cancels,
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
