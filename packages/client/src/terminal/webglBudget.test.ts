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
import { admitWebglTiles, WEBGL_CONTEXT_CAP } from "./webglBudget";

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
});
