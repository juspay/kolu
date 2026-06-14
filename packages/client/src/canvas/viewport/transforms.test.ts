/** Transparency tests for `applyGestureBatch` — the per-frame coalescing of
 *  wheel pan/zoom that R4 introduced to kill the #1308 write-storm.
 *
 *  The safety argument for coalescing is "a PURE-pan or PURE-zoom frame lands on
 *  the EXACT same pan+zoom the old per-event path reached, so feel is unchanged"
 *  (a wheel event is pan XOR zoom, so a gesture is overwhelmingly one regime).
 *  Canvas gestures have no e2e coverage, so these pin that equivalence directly:
 *  a summed pan delta equals the sum of per-event pans, and a per-event-clamped
 *  zoom factor toward a fixed anchor equals the chain of per-event zooms — even
 *  across a MIN/MAX_ZOOM bound (the `accumulateZoom` suite, codex F1). The one
 *  mixed pan+zoom test documents the accepted zoom-then-pan approximation. If a
 *  future edit breaks an equivalence, these go red instead of a silent change in
 *  pan/zoom feel. */

import { describe, expect, it } from "vitest";
import {
  accumulateZoom,
  applyGestureBatch,
  type GestureBatch,
  MAX_ZOOM,
  MIN_ZOOM,
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

/** Per-event reference: the old path applied `zoomTowardPoint` (which clamps)
 *  per raw factor toward the live anchor. These pin that the accumulate-then-
 *  apply batch reaches the SAME pan+zoom even when an event hits a bound — the
 *  case a raw product-of-factors gets wrong (codex F1). */
function perEventZoomChain(
  start: { panX: number; panY: number; zoom: number },
  factors: number[],
  anchorX: number,
  anchorY: number,
) {
  let s = start;
  for (const f of factors) {
    s = zoomTowardPoint(s.panX, s.panY, s.zoom, f, anchorX, anchorY);
  }
  return s;
}

function batchedZoom(
  start: { panX: number; panY: number; zoom: number },
  factors: number[],
  anchorX: number,
  anchorY: number,
) {
  const b = batch({ zoomAnchorX: anchorX, zoomAnchorY: anchorY });
  for (const f of factors) accumulateZoom(b, start.zoom, f);
  return applyGestureBatch(start.panX, start.panY, start.zoom, b);
}

describe("accumulateZoom (per-event clamping)", () => {
  const anchorX = 140;
  const anchorY = 90;

  it("matches the unclamped per-event chain when no bound is hit", () => {
    const start = { panX: 12, panY: -8, zoom: 1 };
    const factors = [1.1, 1.1, 0.95, 1.2];
    const ref = perEventZoomChain(start, factors, anchorX, anchorY);
    const got = batchedZoom(start, factors, anchorX, anchorY);
    close(got.panX, ref.panX);
    close(got.panY, ref.panY);
    close(got.zoom, ref.zoom);
  });

  it("overshoot past MAX then reverse does NOT cancel (F1)", () => {
    // From the bound, [1.25, 0.8] has product 1 — a raw product stays put. The
    // per-event path clamps the first to MAX_ZOOM, then zooms back out to 2.4.
    const start = { panX: 30, panY: 15, zoom: MAX_ZOOM };
    const factors = [1.25, 0.8];
    const ref = perEventZoomChain(start, factors, anchorX, anchorY);
    expect(ref.zoom).toBeCloseTo(MAX_ZOOM * 0.8, 9);
    const got = batchedZoom(start, factors, anchorX, anchorY);
    close(got.zoom, ref.zoom);
    close(got.panX, ref.panX);
    close(got.panY, ref.panY);
    // Guard against the regression: it must NOT stay pinned at the bound.
    expect(got.zoom).toBeLessThan(MAX_ZOOM);
  });

  it("overshoot past MIN then reverse does NOT cancel", () => {
    const start = { panX: -5, panY: 22, zoom: MIN_ZOOM };
    const factors = [0.5, 2]; // product 1, but first clamps to MIN
    const ref = perEventZoomChain(start, factors, anchorX, anchorY);
    expect(ref.zoom).toBeCloseTo(MIN_ZOOM * 2, 9);
    const got = batchedZoom(start, factors, anchorX, anchorY);
    close(got.zoom, ref.zoom);
    close(got.panX, ref.panX);
    close(got.panY, ref.panY);
    expect(got.zoom).toBeGreaterThan(MIN_ZOOM);
  });

  it("matches the clamped per-event chain through repeated bound crossings", () => {
    const start = { panX: 7, panY: -3, zoom: 2.5 };
    // A jittery fling that pins at MAX several times then comes back down.
    const factors = [1.4, 1.4, 0.7, 1.5, 0.6, 0.6, 1.3];
    const ref = perEventZoomChain(start, factors, anchorX, anchorY);
    const got = batchedZoom(start, factors, anchorX, anchorY);
    close(got.zoom, ref.zoom);
    close(got.panX, ref.panX);
    close(got.panY, ref.panY);
  });
});
