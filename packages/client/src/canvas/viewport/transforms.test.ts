import { describe, expect, it } from "vitest";
import {
  accumulateZoom,
  applyZoomThenPan,
  computeCenterPan,
  type GestureBatch,
  MAX_ZOOM,
  MIN_ZOOM,
  NO_ZOOM,
  viewportCenter,
  zoomTowardPoint,
} from "./transforms";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const batch = (o: Partial<GestureBatch>): GestureBatch => ({
  panDx: 0,
  panDy: 0,
  netClampedZoomRatio: NO_ZOOM,
  zoomAnchorX: 0,
  zoomAnchorY: 0,
  ...o,
});

describe("applyZoomThenPan", () => {
  it("is the identity for an empty batch", () => {
    const r = applyZoomThenPan(10, 20, 1.5, batch({}));
    expect(r).toEqual({ panX: 10, panY: 20, zoom: 1.5 });
  });

  it("summed pan delta === the sum of per-event pans (constant zoom)", () => {
    const z = 2;
    const events: [number, number][] = [
      [5, 7],
      [3, -4],
      [11, 2],
    ];
    let px = 10;
    let py = 20;
    for (const [dx, dy] of events) {
      px += dx / z;
      py += dy / z;
    }
    const sumDx = events.reduce((a, [dx]) => a + dx, 0);
    const sumDy = events.reduce((a, [, dy]) => a + dy, 0);
    const r = applyZoomThenPan(
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
    let s = { panX: 12, panY: -8, zoom: 1 };
    for (const f of factors) {
      s = zoomTowardPoint(s.panX, s.panY, s.zoom, f, anchorX, anchorY);
    }
    const b = batch({ zoomAnchorX: anchorX, zoomAnchorY: anchorY });
    for (const f of factors) accumulateZoom(b, 1, f);
    const r = applyZoomThenPan(12, -8, 1, b);
    close(r.panX, s.panX);
    close(r.panY, s.panY);
    close(r.zoom, s.zoom);
  });

  it("applies zoom before pan in a mixed frame (pan lands in the post-zoom scale)", () => {
    const b = batch({ panDx: 20, panDy: 0, zoomAnchorX: 0, zoomAnchorY: 0 });
    accumulateZoom(b, 1, 2);
    const r = applyZoomThenPan(0, 0, 1, b);
    close(r.panX, 10);
    expect(r.zoom).toBe(2);
  });
});

describe("viewportCenter", () => {
  it("is the inverse of computeCenterPan (round-trips a desired center)", () => {
    const cases: { cx: number; cy: number; w: number; h: number; z: number }[] =
      [
        { cx: 400, cy: 270, w: 1280, h: 720, z: 1 },
        { cx: -150, cy: 90, w: 800, h: 600, z: 2 },
        { cx: 33.5, cy: -12.25, w: 1024, h: 768, z: 0.5 },
      ];
    for (const { cx, cy, w, h, z } of cases) {
      const { panX, panY } = computeCenterPan(cx, cy, cx, cy, w, h, z);
      const got = viewportCenter(panX, panY, w, h, z);
      close(got.x, cx);
      close(got.y, cy);
    }
  });
});

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
  return applyZoomThenPan(start.panX, start.panY, start.zoom, b);
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
    const start = { panX: 30, panY: 15, zoom: MAX_ZOOM };
    const factors = [1.25, 0.8];
    const ref = perEventZoomChain(start, factors, anchorX, anchorY);
    expect(ref.zoom).toBeCloseTo(MAX_ZOOM * 0.8, 9);
    const got = batchedZoom(start, factors, anchorX, anchorY);
    close(got.zoom, ref.zoom);
    close(got.panX, ref.panX);
    close(got.panY, ref.panY);
    expect(got.zoom).toBeLessThan(MAX_ZOOM);
  });

  it("overshoot past MIN then reverse does NOT cancel", () => {
    const start = { panX: -5, panY: 22, zoom: MIN_ZOOM };
    const factors = [0.5, 2];
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
    const factors = [1.4, 1.4, 0.7, 1.5, 0.6, 0.6, 1.3];
    const ref = perEventZoomChain(start, factors, anchorX, anchorY);
    const got = batchedZoom(start, factors, anchorX, anchorY);
    close(got.zoom, ref.zoom);
    close(got.panX, ref.panX);
    close(got.panY, ref.panY);
  });
});
