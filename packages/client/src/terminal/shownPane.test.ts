import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { describe, expect, it } from "vitest";
import { createShownPane } from "./shownPane";

function harness(init?: { grid?: TerminalGrid | null; visible?: boolean }) {
  let grid: TerminalGrid | null =
    init && "grid" in init ? (init.grid ?? null) : null;
  let visible = init?.visible ?? false;
  const attachedAt: (TerminalGrid | null)[] = [];
  const published: TerminalGrid[] = [];
  let detaches = 0;
  let cancels = 0;
  const pane = createShownPane({
    shown: () => grid !== null && visible,
    attach: () => attachedAt.push(grid),
    detach: () => {
      detaches += 1;
    },
    publish: (g) => published.push(g),
    cancelPublish: () => {
      cancels += 1;
    },
  });
  return {
    measure(next: TerminalGrid | null) {
      grid = next;
      pane.observe();
      if (next) pane.measured(next);
    },
    show(next: boolean) {
      visible = next;
      pane.observe();
    },
    pane,
    attachedAt,
    published,
    detaches: () => detaches,
    cancels: () => cancels,
  };
}

describe("the shown-pane gate", () => {
  it("a measured but hidden pane attaches nothing and publishes nothing", () => {
    const h = harness({ visible: false });
    h.measure({ cols: 80, rows: 24 });
    h.measure({ cols: 132, rows: 43 });
    expect(h.attachedAt).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it("a visible pane that has not measured attaches nothing", () => {
    const h = harness({ visible: true });
    expect(h.attachedAt).toEqual([]);
    h.measure({ cols: 100, rows: 30 });
    expect(h.attachedAt).toEqual([{ cols: 100, rows: 30 }]);
  });

  it("the reveal attaches at the grid the pane measured while hidden", () => {
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
    const h = harness({ visible: true });
    h.measure({ cols: 132, rows: 43 });
    expect(h.published).toEqual([{ cols: 132, rows: 43 }]);
    expect(h.cancels()).toBe(0);
    h.show(false);
    expect(h.cancels()).toBe(1);
    h.show(true);
    expect(h.cancels()).toBe(1);
  });

  it("acts on CHANGES only, however often it is asked", () => {
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    for (let i = 0; i < 5; i++) h.pane.observe();
    expect(h.attachedAt).toHaveLength(1);
    h.show(true);
    expect(h.attachedAt).toHaveLength(1);
    expect(h.detaches()).toBe(0);
  });

  it("a pane that loses its measurement detaches", () => {
    const h = harness({ visible: true });
    h.measure({ cols: 80, rows: 24 });
    h.measure(null);
    expect(h.detaches()).toBe(1);
  });
});
