import { describe, expect, it } from "vitest";
import { tileTransformCSS } from "./coordinates";

describe("tileTransformCSS", () => {
  it("snaps fractional trackpad pans to device pixels at DPR 1", () => {
    expect(tileTransformCSS(0, 0, -242.5, 11.5, 1, 0, 0, 1)).toBe(
      "translate(243px, -11px) scale(1)",
    );
  });

  it.each([
    [1.25, "translate(0.8px, -0.8px) scale(1)"],
    [1.5, "translate(0.6666666666666666px, -1.3333333333333333px) scale(1)"],
  ] as const)("snaps to device pixels at fractional DPR %s", (dpr, expected) => {
    const transform = tileTransformCSS(0, 0, -0.5, 1.1, 1, 0, 0, dpr);
    expect(transform).toBe(expected);
    const [, tx, ty] = transform.match(/translate\(([^p]+)px, ([^p]+)px\)/)!;
    expect(Number.isInteger(Number(tx) * dpr)).toBe(true);
    expect(Number.isInteger(Number(ty) * dpr)).toBe(true);
  });

  it("retains half-CSS-pixel translations at DPR 2", () => {
    expect(tileTransformCSS(0, 0, -0.25, -0.25, 1, 0, 0, 2)).toBe(
      "translate(0.5px, 0.5px) scale(1)",
    );
  });

  it("snaps the composed layout, pan and drag while preserving zoom", () => {
    expect(tileTransformCSS(10, 20, 2.5, 3.5, 1.5, 0.25, -0.25, 1)).toBe(
      "translate(2px, 5px) scale(1.5)",
    );
  });

  it("does not emit negative zero when a negative translation snaps to zero", () => {
    expect(tileTransformCSS(0, 0, 0.25, 0.25, 1, 0, 0, 1)).toBe(
      "translate(0px, 0px) scale(1)",
    );
  });
});
