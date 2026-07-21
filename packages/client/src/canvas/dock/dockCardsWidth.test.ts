import { describe, expect, it } from "vitest";
import {
  CARDS_WIDTH_PX,
  clampDockCardsWidth,
  effectiveDockCardsWidth,
} from "./dockCardsWidth";

// The drag setter and the stored-value parse both route through
// `clampDockCardsWidth`, so a pointer-drag past either edge — or a
// hand-edited `localStorage` value — is pinned into the legible range
// rather than collapsing the dock to nothing or letting it swallow the
// canvas. Bounds (200…560) are asserted at the edges, not by re-importing
// the private constants, so the test guards the contract, not the literals.
describe("clampDockCardsWidth", () => {
  it("passes an in-range width through unchanged", () => {
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

// The rendered width is capped to the flex host so a stored-wide dock can never
// squeeze the canvas below a usable minimum (320px) or clip its own right-edge
// handle off-screen — the recoverability contract. The reserve (320) is asserted
// by behaviour at the boundary, not by importing the private constant.
describe("effectiveDockCardsWidth", () => {
  it("renders the preference unchanged when the host has ample room", () => {
    // 1200px host − 320px reserve = 880px available, well above a 400px pref.
    expect(effectiveDockCardsWidth(400, 1200)).toBe(400);
  });

  it("caps the rendered width so the canvas keeps its reserve (handle stays reachable)", () => {
    // 640px host: a stored 560px would leave only 80px of canvas and clip the
    // handle. Capped to 640 − 320 = 320.
    expect(effectiveDockCardsWidth(560, 640)).toBe(320);
  });

  it("never renders below the width floor even on a very narrow host", () => {
    // 400px host − 320 reserve = 80, but the dock floor (200) wins; the narrow
    // host is its own degenerate case, not the persisted-width trap.
    expect(effectiveDockCardsWidth(560, 400)).toBe(200);
  });

  it("falls back to the clamped preference before the host is measured", () => {
    expect(effectiveDockCardsWidth(560, 0)).toBe(560);
    expect(effectiveDockCardsWidth(9999, Number.NaN)).toBe(560);
    expect(effectiveDockCardsWidth(150, 0)).toBe(200);
  });
});
