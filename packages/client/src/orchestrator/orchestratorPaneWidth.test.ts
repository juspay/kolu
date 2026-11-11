/** The chat/peek split's bounds — the ones a drag may reach, and the ones a
 *  stored number is held to.
 *
 *  The bug these pin: the divider used to stop at half the window (a 760px
 *  ceiling and a `max-width: 60%`), so a person reading a long answer could not
 *  give the chat the room and a person watching a terminal could not give the
 *  peek it either. The rule now is two minima and nothing in between. */

import { describe, expect, it } from "vitest";
import { readWithFallback } from "../persistedPref";
import {
  clampDraggedPaneWidth,
  clampStoredPaneWidth,
  PANE_MAX_WIDTH_PX,
  PANE_MIN_WIDTH_PX,
  PANE_WIDTH_PX,
  PEEK_MIN_WIDTH_PX,
  parsePaneWidth,
} from "./orchestratorPaneWidth";

describe("clampDraggedPaneWidth — what the grip may reach", () => {
  const ROW = 1600;

  it("lets the chat take everything but the peek's minimum", () => {
    expect(clampDraggedPaneWidth(ROW, ROW)).toBe(ROW - PEEK_MIN_WIDTH_PX);
  });

  it("lets the chat past half the row — the whole point", () => {
    // 1000 of 1600 is 62%, which the old clamp refused twice over.
    expect(clampDraggedPaneWidth(1000, ROW)).toBe(1000);
  });

  it("keeps the composer's floor when the drag goes the other way", () => {
    expect(clampDraggedPaneWidth(0, ROW)).toBe(PANE_MIN_WIDTH_PX);
  });

  it("leaves everything between the two minima free", () => {
    expect(clampDraggedPaneWidth(PANE_MIN_WIDTH_PX, ROW)).toBe(
      PANE_MIN_WIDTH_PX,
    );
    expect(clampDraggedPaneWidth(ROW - PEEK_MIN_WIDTH_PX - 1, ROW)).toBe(
      ROW - PEEK_MIN_WIDTH_PX - 1,
    );
  });

  it("gives the composer the row when both minima cannot fit", () => {
    // A 400px row cannot hold 320 + 240. The chat's floor wins: a box you
    // cannot type in is worse than a peek you cannot read.
    expect(clampDraggedPaneWidth(1000, 400)).toBe(PANE_MIN_WIDTH_PX);
    expect(clampDraggedPaneWidth(0, 400)).toBe(PANE_MIN_WIDTH_PX);
  });
});

describe("clampStoredPaneWidth — what may be remembered", () => {
  it("keeps an ordinary width untouched", () => {
    expect(clampStoredPaneWidth(1200)).toBe(1200);
    expect(clampStoredPaneWidth(PANE_WIDTH_PX)).toBe(PANE_WIDTH_PX);
  });

  it("holds a width wider than any display to the ceiling", () => {
    expect(clampStoredPaneWidth(99_999)).toBe(PANE_MAX_WIDTH_PX);
  });

  it("holds a width under the composer's floor to the floor", () => {
    expect(clampStoredPaneWidth(10)).toBe(PANE_MIN_WIDTH_PX);
  });

  it("remembers a width a big monitor earned, far past the old 760 ceiling", () => {
    expect(clampStoredPaneWidth(2400)).toBe(2400);
  });
});

describe("parsePaneWidth — the stored value on the way back in", () => {
  it("CLAMPS an out-of-range number to the nearest bound", () => {
    // Not a fallback: a width somebody dragged on a wider screen is still
    // their width, so it comes back as the nearest one this build allows.
    expect(parsePaneWidth("99999")).toBe(PANE_MAX_WIDTH_PX);
    expect(parsePaneWidth("1")).toBe(PANE_MIN_WIDTH_PX);
  });

  it("round-trips the canonical serialization", () => {
    expect(parsePaneWidth(JSON.stringify(1280))).toBe(1280);
  });

  it("throws on anything that is not a finite number", () => {
    expect(() => parsePaneWidth('"28rem"')).toThrow(/invalid/);
    expect(() => parsePaneWidth("null")).toThrow(/invalid/);
    expect(() => parsePaneWidth("abc")).toThrow();
  });

  it("falls back only when the stored value is not a width at all", () => {
    expect(readWithFallback("abc", parsePaneWidth, PANE_WIDTH_PX)).toBe(
      PANE_WIDTH_PX,
    );
    // ...and NOT for a number out of range, which clamps instead.
    expect(readWithFallback("99999", parsePaneWidth, PANE_WIDTH_PX)).toBe(
      PANE_MAX_WIDTH_PX,
    );
  });
});
