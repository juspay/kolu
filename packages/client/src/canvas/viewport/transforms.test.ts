/** Transparency tests for `applyGestureBatch` — the per-frame coalescing of
 *  wheel pan/zoom that R4 introduced to kill the #1308 write-storm.
 *
 *  The whole safety argument for coalescing is "a batched frame lands on the
 *  EXACT same pan+zoom the old per-event path reached, so feel is unchanged."
 *  Canvas gestures have no e2e coverage, so these pin that equivalence directly:
 *  a summed pan delta equals the sum of per-event pans, and a product of zoom
 *  factors toward a fixed anchor equals the chain of per-event zooms (the
 *  telescoping the batch relies on). If a future edit breaks the equivalence,
 *  these go red instead of a silent change in pan/zoom feel. */

import { describe, expect, it } from "vitest";
import {
  applyGestureBatch,
  type GestureBatch,
  zoomTowardPoint,
} from "./transforms";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const batch = (o: Partial<GestureBatch>): GestureBatch => ({
  panDx: 0,
  panDy: 0,
  zoomFactor: 1,
  zoomAnchorX: 0,
  zoomAnchorY: 0,
  ...o,
});

describe("applyGestureBatch", () => {
  it("is the identity for an empty batch", () => {
    const r = applyGestureBatch(10, 20, 1.5, batch({}));
    expect(r).toEqual({ panX: 10, panY: 20, zoom: 1.5 });
  });

  it("summed pan delta === the sum of per-event pans (constant zoom)", () => {
    const z = 2;
    const events: [number, number][] = [
      [5, 7],
      [3, -4],
      [11, 2],
    ];
    // Per-event path: each event wrote setPanX(panX + dx/z).
    let px = 10;
    let py = 20;
    for (const [dx, dy] of events) {
      px += dx / z;
      py += dy / z;
    }
    const sumDx = events.reduce((a, [dx]) => a + dx, 0);
    const sumDy = events.reduce((a, [, dy]) => a + dy, 0);
    const r = applyGestureBatch(
      10,
      20,
      z,
      batch({ panDx: sumDx, panDy: sumDy }),
    );
    close(r.panX, px);
    close(r.panY, py);
    expect(r.zoom).toBe(z);
  });

  it("product zoom factor toward a fixed anchor === the per-event zoom chain", () => {
    const anchorX = 140;
    const anchorY = 90;
    const factors = [1.1, 1.1, 0.95, 1.2];
    // Per-event path: chained zoomTowardPoint calls toward the same anchor.
    let s = { panX: 12, panY: -8, zoom: 1 };
    for (const f of factors) {
      s = zoomTowardPoint(s.panX, s.panY, s.zoom, f, anchorX, anchorY);
    }
    const product = factors.reduce((a, f) => a * f, 1);
    const r = applyGestureBatch(
      12,
      -8,
      1,
      batch({
        zoomFactor: product,
        zoomAnchorX: anchorX,
        zoomAnchorY: anchorY,
      }),
    );
    close(r.panX, s.panX);
    close(r.panY, s.panY);
    close(r.zoom, s.zoom);
  });

  it("applies zoom before pan in a mixed frame (pan lands in the post-zoom scale)", () => {
    const r = applyGestureBatch(
      0,
      0,
      1,
      batch({
        panDx: 20,
        panDy: 0,
        zoomFactor: 2,
        zoomAnchorX: 0,
        zoomAnchorY: 0,
      }),
    );
    // Zoom toward (0,0) by 2 leaves pan at 0 (anchor is the origin), so the pan
    // delta divides by the NEW zoom (2), not the old (1): 20 / 2 = 10.
    close(r.panX, 10);
    expect(r.zoom).toBe(2);
  });
});
