/** Regression guard for the #1399 WebGL-context budget.
 *
 *  The leak: the budget used to be a fixed `slice(0, 2)` — only the 2
 *  most-recently-active tiles held a WebGL context. With more terminals in play,
 *  every focus switch evicted+recreated a context, and on Chrome+AMD that churn
 *  leaked GPU VRAM (reclaimed only at GC) until the GPU faulted. The fix admits
 *  the whole working set, capped by counting *actual* contexts (main pane + an
 *  expanded active split) against a margin below Chrome's measured 16/tab limit
 *  (#575). `admitWebglTiles` is the pure core of that policy.
 *
 *  These assert the two properties the fix hinges on: (1) a realistic
 *  multi-terminal working set is admitted *in full* (no churn — the regression),
 *  and (2) past the cap, admission is bounded by recency so live contexts never
 *  exceed Chrome's limit. */

import { describe, expect, it } from "vitest";
import type { TerminalId } from "kolu-common/surface";
import {
  admitWebglTiles,
  isActiveSplit,
  tileWebglCost,
  WEBGL_CONTEXT_CAP,
} from "./webglBudget";

const ids = (n: number): TerminalId[] =>
  Array.from({ length: n }, (_, i) => `t${i}` as TerminalId);
const one = () => 1; // every tile costs one context (no split)

describe("admitWebglTiles (#1399 WebGL context budget)", () => {
  it("admits the FULL working set when it fits under the cap — the regression (old slice(0,2) truncated to 2)", () => {
    const tiles = ids(6); // a realistic multi-terminal session
    expect(admitWebglTiles(tiles, one, 12)).toEqual(tiles);
  });

  it("admits a working set sized exactly at the cap", () => {
    const tiles = ids(12);
    expect(admitWebglTiles(tiles, one, 12)).toEqual(tiles);
  });

  it("caps by recency when the working set exceeds the limit (never overflows Chrome's per-tab cap, #575)", () => {
    const tiles = ids(20); // mruOrder is most-recent-first
    const held = admitWebglTiles(tiles, one, 12);
    expect(held).toHaveLength(12);
    expect(held).toEqual(tiles.slice(0, 12));
  });

  it("counts an expanded active split as a second context", () => {
    const tiles = ids(8);
    // Every tile carries an active split → costs 2 contexts each → cap 12 fits 6.
    const held = admitWebglTiles(tiles, () => 2, 12);
    expect(held).toEqual(tiles.slice(0, 6));
  });

  it("admits nothing when the first tile alone would exceed the cap", () => {
    expect(admitWebglTiles(ids(3), () => 5, 4)).toEqual([]);
  });

  it("the shipped default cap holds a realistic 6-terminal set churn-free", () => {
    expect(WEBGL_CONTEXT_CAP).toBeGreaterThanOrEqual(6);
    expect(admitWebglTiles(ids(6), one, WEBGL_CONTEXT_CAP)).toEqual(ids(6));
  });

  it("throws when costOf returns 0 — guards against infinite loop", () => {
    expect(() => admitWebglTiles(ids(1), () => 0, 12)).toThrow(
      /admitWebglTiles: costOf returned 0/,
    );
  });

  it("throws when costOf returns a negative number — guards against infinite loop", () => {
    expect(() => admitWebglTiles(ids(1), () => -1, 12)).toThrow(
      /admitWebglTiles: costOf returned -1/,
    );
  });
});

const SUB = "sub" as TerminalId;

describe("tileWebglCost (the #575 cost model, pinned directly)", () => {
  it("a tile with no split costs 1 (main pane only)", () => {
    expect(tileWebglCost({ collapsed: false, activeSubTab: null })).toBe(1);
  });

  it("a tile with an expanded, active split costs 2 (main + split)", () => {
    expect(tileWebglCost({ collapsed: false, activeSubTab: SUB })).toBe(2);
  });

  it("a collapsed split costs 1 — it's invisible, holds no context", () => {
    expect(tileWebglCost({ collapsed: true, activeSubTab: SUB })).toBe(1);
  });
});

describe("isActiveSplit (which child inherits the tile's WebGL slot)", () => {
  it("true only for the active, non-collapsed split child", () => {
    expect(isActiveSplit({ collapsed: false, activeSubTab: SUB }, SUB)).toBe(
      true,
    );
  });

  it("false for a non-active sibling", () => {
    expect(
      isActiveSplit(
        { collapsed: false, activeSubTab: SUB },
        "other" as TerminalId,
      ),
    ).toBe(false);
  });

  it("false when the split is collapsed", () => {
    expect(isActiveSplit({ collapsed: true, activeSubTab: SUB }, SUB)).toBe(
      false,
    );
  });

  it("false when there is no active split", () => {
    expect(isActiveSplit({ collapsed: false, activeSubTab: null }, SUB)).toBe(
      false,
    );
  });
});

describe("cost ↔ grant agreement (the unenforced invariant, mechanized)", () => {
  // The store's holdsWebgl grants a budgeted tile's main pane plus, per child,
  // `isActiveSplit`. `tileWebglCost` MUST equal the number of terminals under
  // the tile for which that grant holds, or admitWebglTiles miscounts real
  // Chrome contexts (#575). These mirror the store's logic over the SAME
  // predicates, so a future split-rule change keeps both sides in step.
  const children = [SUB, "sibling" as TerminalId];
  const grantedCount = (panel: {
    collapsed: boolean;
    activeSubTab: TerminalId | null;
  }) =>
    1 /* main pane, always granted to a budgeted tile */ +
    children.filter((id) => isActiveSplit(panel, id)).length;

  it.each([
    ["no split", { collapsed: false, activeSubTab: null }],
    ["active split", { collapsed: false, activeSubTab: SUB }],
    ["collapsed split", { collapsed: true, activeSubTab: SUB }],
  ] as const)("cost equals granted-terminal count: %s", (_label, panel) => {
    expect(tileWebglCost(panel)).toBe(grantedCount(panel));
  });
});
