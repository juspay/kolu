/** Geometry tests for `unscaleEventPoint` — the inverse-transform that makes
 *  xterm's mouse hit-testing land on the right cell when a canvas tile is
 *  zoomed (#1400). The end-to-end behavior is pinned by
 *  `packages/tests/features/canvas-selection.feature`; these pin the math.
 *
 *  The correction must be a STRICT identity for untransformed terminals
 *  (split / sub-panels, zoom = 1) and for pure pans (translate, scale 1), since
 *  those paths render xterm with no scale and selection already works — a
 *  non-identity there would regress the common case. Under a `scale(zoom)`
 *  ancestor it must invert the scale about the element's border-box top-left
 *  (the fixed point xterm subtracts via `getBoundingClientRect().left`). */

import { describe, expect, it } from "vitest";
import { unscaleEventPoint } from "./xtermInternals";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

describe("unscaleEventPoint", () => {
  it("is the identity at scale 1 (untransformed terminal)", () => {
    const r = rect(100, 50, 800, 600);
    expect(unscaleEventPoint(300, 250, r, 800, 600)).toEqual({
      clientX: 300,
      clientY: 250,
    });
  });

  it("is the identity for a pure translate (rect moved, size unchanged)", () => {
    // Pan at zoom 1: getBoundingClientRect().left/top shift but width/height
    // still equal the layout size, so scale is 1 and the point is untouched —
    // xterm already absorbs the translate via rect.left/top.
    const r = rect(420, -30, 800, 600);
    expect(unscaleEventPoint(500, 100, r, 800, 600)).toEqual({
      clientX: 500,
      clientY: 100,
    });
  });

  it("inverse-maps a uniform 2x zoom back to logical pixels", () => {
    // Layout 400x300 rendered at scale 2 → rect 800x600. A point 200 screen-px
    // right of the element's left edge is 100 logical-px in.
    const r = rect(100, 50, 800, 600);
    const out = unscaleEventPoint(100 + 200, 50 + 120, r, 400, 300);
    expect(out.clientX).toBeCloseTo(200, 9); // 100 + 200/2
    expect(out.clientY).toBeCloseTo(110, 9); // 50 + 120/2
  });

  it("keeps the element's top-left a fixed point under zoom", () => {
    const r = rect(100, 50, 800, 600);
    expect(unscaleEventPoint(100, 50, r, 400, 300)).toEqual({
      clientX: 100,
      clientY: 50,
    });
  });

  it("handles non-uniform scale independently per axis", () => {
    const r = rect(0, 0, 600, 300); // 3x wide, 1.5x tall vs layout 200x200
    const out = unscaleEventPoint(300, 150, r, 200, 200);
    expect(out.clientX).toBeCloseTo(100, 9); // 300 / 3
    expect(out.clientY).toBeCloseTo(100, 9); // 150 / 1.5
  });

  it("falls back to identity when layout size is 0 (unmeasurable / display:none)", () => {
    const r = rect(0, 0, 0, 0);
    expect(unscaleEventPoint(42, 17, r, 0, 0)).toEqual({
      clientX: 42,
      clientY: 17,
    });
  });
});
