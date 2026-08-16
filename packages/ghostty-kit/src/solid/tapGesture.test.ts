import { describe, expect, it } from "vitest";
import { shouldActivateTap } from "./tapGesture.ts";

const tap = {
  startX: 100,
  startY: 100,
  focusedThisGesture: false,
  pointerType: "mouse",
};

describe("shouldActivateTap", () => {
  it("suppresses a drag that ends over a path-looking cell", () => {
    expect(shouldActivateTap(tap, 140, 100)).toBe(false);
  });

  it("suppresses a mouse click whose only job was focusing the tile", () => {
    expect(
      shouldActivateTap({ ...tap, focusedThisGesture: true }, 101, 101),
    ).toBe(false);
  });

  it("still allows a genuine tap on an already-focused tile", () => {
    expect(shouldActivateTap(tap, 102, 101)).toBe(true);
  });

  it("still allows a touch tap that did not focus on pointerdown", () => {
    expect(
      shouldActivateTap(
        { ...tap, pointerType: "touch", focusedThisGesture: false },
        102,
        101,
      ),
    ).toBe(true);
  });
});
