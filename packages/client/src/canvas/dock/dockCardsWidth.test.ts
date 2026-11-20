import { describe, expect, it } from "vitest";
import {
  CARDS_WIDTH_PX,
  clampDockCardsWidth,
  renderedDockWidth,
} from "./dockCardsWidth";

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

const maximizedCards = (preferredPx: number, hostWidthPx: number) =>
  renderedDockWidth({
    mode: "cards",
    layout: "maximized",
    preferredPx,
    hostWidthPx,
  });

describe("renderedDockWidth", () => {
  it("renders the preference unchanged when the host has ample room", () => {
    expect(maximizedCards(400, 1200)).toEqual({ px: 400, resizable: true });
  });

  it("caps the rendered width so the canvas keeps its reserve (handle stays reachable)", () => {
    expect(maximizedCards(560, 640).px).toBe(320);
  });

  it("never renders below the width floor even on a very narrow host", () => {
    expect(maximizedCards(560, 400).px).toBe(200);
  });

  it("falls back to the clamped preference before the host is measured", () => {
    expect(maximizedCards(560, 0).px).toBe(560);
    expect(maximizedCards(9999, Number.NaN).px).toBe(560);
    expect(maximizedCards(150, 0).px).toBe(200);
  });

  it("gives the rail its fixed width and no resize handle", () => {
    expect(
      renderedDockWidth({
        mode: "rail",
        layout: "maximized",
        preferredPx: 500,
        hostWidthPx: 1200,
      }),
    ).toEqual({ px: 44, resizable: false });
  });

  it("gives a tiled cards dock the default width and no resize handle", () => {
    expect(
      renderedDockWidth({
        mode: "cards",
        layout: "tiled",
        preferredPx: 500,
        hostWidthPx: 1200,
      }),
    ).toEqual({ px: CARDS_WIDTH_PX, resizable: false });
  });
});
