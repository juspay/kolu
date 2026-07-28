/** "The active tile" and "the terminal you are typing in" are different facts,
 *  and a split is where they come apart.
 *
 *  Reported from the running app: clicking a split's dock entry moved focus
 *  into that pane and highlighted the PARENT row, leaving the entry you clicked
 *  looking untouched. The row attributes took `active` as a parameter, so every
 *  row worked it out for itself — and the split entry, the one row type that
 *  exists *because* its agent was invisible, passed a hardcoded `false`.
 *
 *  The fix is structural rather than a corrected boolean: one derivation names
 *  the focused terminal, and every row reads it. These tests pin the resolution
 *  rule that derivation encodes. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { resolveFocusedTerminal } from "./useFocusedTerminal";

const TILE = "tile" as TerminalId;
const SUB = "sub" as TerminalId;
const OTHER_SUB = "other-sub" as TerminalId;

/** The sub-panel right after clicking a split's dock entry. */
const inTheSplit = {
  collapsed: false,
  activeSubTab: SUB,
  focusTarget: "sub" as const,
};

describe("resolveFocusedTerminal", () => {
  it("names the SPLIT you clicked into, not the tile holding it — THE REPORTED BUG", () => {
    expect(resolveFocusedTerminal(TILE, () => inTheSplit)).toBe(SUB);
  });

  it("names the tile when focus is in the main pane", () => {
    // The tab stays selected, but you are typing in the terminal above it.
    expect(
      resolveFocusedTerminal(TILE, () => ({
        ...inTheSplit,
        focusTarget: "main",
      })),
    ).toBe(TILE);
  });

  it("names the tile when the panel is collapsed", () => {
    // `focusTarget` remembers a choice made before collapsing; there is no
    // visible pane to be focused in until it reopens.
    expect(
      resolveFocusedTerminal(TILE, () => ({ ...inTheSplit, collapsed: true })),
    ).toBe(TILE);
  });

  it("follows the selected tab when you switch splits", () => {
    expect(
      resolveFocusedTerminal(TILE, () => ({
        ...inTheSplit,
        activeSubTab: OTHER_SUB,
      })),
    ).toBe(OTHER_SUB);
  });

  it("falls back to the tile when the panel is open at no tab", () => {
    expect(
      resolveFocusedTerminal(TILE, () => ({
        ...inTheSplit,
        activeSubTab: null,
      })),
    ).toBe(TILE);
  });

  it("names nothing when no tile is active", () => {
    expect(resolveFocusedTerminal(null, () => inTheSplit)).toBeNull();
  });

  // The invariant the whole shape buys: exactly one row can be the focused row.
  // While focus is in a split, the parent must NOT also answer yes — two lit
  // rows answer "where am I" twice.
  it("never names the tile and its split at the same time", () => {
    const focused = resolveFocusedTerminal(TILE, () => inTheSplit);
    expect(focused === TILE && focused === SUB).toBe(false);
    expect(focused).not.toBe(TILE);
  });
});

// ── THE SECOND REPORTED BUG ───────────────────────────────────────────────
// The fix above broke the dock's active highlight for every terminal that
// HOLDS a split. Two causes, both in how absence was handled.
describe("resolveFocusedTerminal — a terminal that merely HAS splits", () => {
  it("names the TILE when you have never focused into a split", () => {
    // No panel state at all. The sub-panel store SEEDS `focusTarget: "sub"`
    // on first touch, so any reader that accepted a seeded default answered
    // "the split" for a terminal the user was plainly working in — and the
    // parent row went dark the moment a terminal grew a split.
    expect(resolveFocusedTerminal(TILE, () => undefined)).toBe(TILE);
  });

  it("asks with a READ, never seeding state as a side effect", () => {
    // The reader used to call `getSubPanel`, which seeds through
    // `ensureState` — so asking where focus is CREATED the wrong answer, from
    // inside a memo. Reading is a read.
    const peek = vi.fn(() => undefined);
    expect(resolveFocusedTerminal(TILE, peek)).toBe(TILE);
    expect(peek).toHaveBeenCalledTimes(1);
  });
});
