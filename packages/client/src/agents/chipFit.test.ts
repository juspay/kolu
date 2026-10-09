import { describe, expect, it } from "vitest";
import { chipsThatFit } from "./chipFit";

describe("chipsThatFit", () => {
  // Five 60px chips with 6px gaps span 324px; the `+N` chip is 40px.
  const five = [60, 60, 60, 60, 60];

  it("all of them when they fit", () => {
    expect(chipsThatFit(five, 40, 6, 324)).toBe(5);
    expect(chipsThatFit(five, 40, 6, 1000)).toBe(5);
  });

  it("as many as fit beside the +N chip", () => {
    // 3 chips (192) + gap + +N (40) = 238.
    expect(chipsThatFit(five, 40, 6, 238)).toBe(3);
    expect(chipsThatFit(five, 40, 6, 237)).toBe(2);
    // 4 chips beside +N need 304: with 323px the fifth does not fit, the
    // fourth does.
    expect(chipsThatFit(five, 40, 6, 323)).toBe(4);
  });

  it("none, leaving only +N, when not even one fits beside it", () => {
    expect(chipsThatFit(five, 40, 6, 100)).toBe(0);
  });

  it("uses each chip's own width", () => {
    expect(chipsThatFit([120, 40, 40], 30, 6, 200)).toBe(1);
  });
});
