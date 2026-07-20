import { describe, expect, it } from "vitest";
import { CARDS_WIDTH_PX, clampDockCardsWidth } from "./dockCardsWidth";

// The drag setter and the stored-value parse both route through
// `clampDockCardsWidth`, so a pointer-drag past either edge — or a
// hand-edited `localStorage` value — is pinned into the legible range
// rather than collapsing the dock to nothing or letting it swallow the
// canvas. Bounds (200…560) are asserted at the edges, not by re-importing
// the private constants, so the test guards the contract, not the literals.
describe("clampDockCardsWidth", () => {
  it("passes an in-range width through unchanged", () => {
    expect(clampDockCardsWidth(CARDS_WIDTH_PX)).toBe(CARDS_WIDTH_PX);
    expect(clampDockCardsWidth(320)).toBe(320);
  });

  it("floors a too-narrow drag so a row stays legible", () => {
    expect(clampDockCardsWidth(0)).toBe(200);
    expect(clampDockCardsWidth(-500)).toBe(200);
    expect(clampDockCardsWidth(199)).toBe(200);
  });

  it("ceils a too-wide drag so the dock can't swallow the canvas", () => {
    expect(clampDockCardsWidth(9999)).toBe(560);
    expect(clampDockCardsWidth(561)).toBe(560);
  });

  it("keeps the default within the clamp range (fresh install lands unchanged)", () => {
    expect(clampDockCardsWidth(CARDS_WIDTH_PX)).toBe(CARDS_WIDTH_PX);
  });
});
