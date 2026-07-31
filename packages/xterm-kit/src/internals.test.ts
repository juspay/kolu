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

import type { Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { cellAtPoint, clearWriteQueue, unscaleEventPoint } from "./internals";

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

  it("round-trips the documented scale-about-(0,0) forward map", () => {
    // The inverse is only valid while the ancestor transform uses
    // `transform-origin: 0 0` (CanvasTile's `tileTransformCSS` contract): the
    // border-box top-left is the fixed point. Pin that by composing the forward
    // map xterm's transformed rect implies — a point scales about the element's
    // top-left, `screenX = rect.left + (logicalX - rect.left) * scaleX` — and
    // asserting `unscaleEventPoint` recovers the original logical point. If
    // CanvasTile ever moves to a non-0/0 origin, this fixed point shifts and
    // this test breaks, so forward/inverse can't silently desync.
    const layoutWidth = 400;
    const layoutHeight = 300;
    const scaleX = 2;
    const scaleY = 1.5;
    const r = rect(100, 50, layoutWidth * scaleX, layoutHeight * scaleY);
    const forward = (logicalX: number, logicalY: number) => ({
      clientX: r.left + (logicalX - r.left) * scaleX,
      clientY: r.top + (logicalY - r.top) * scaleY,
    });
    const cases: [number, number][] = [
      [r.left, r.top], // the fixed point itself
      [250, 175],
      [r.left + layoutWidth, r.top + layoutHeight], // far edge
    ];
    for (const [logicalX, logicalY] of cases) {
      const screen = forward(logicalX, logicalY);
      const out = unscaleEventPoint(
        screen.clientX,
        screen.clientY,
        r,
        layoutWidth,
        layoutHeight,
      );
      expect(out.clientX).toBeCloseTo(logicalX, 9);
      expect(out.clientY).toBeCloseTo(logicalY, 9);
    }
  });
});

/** Contract of `cellAtPoint` — the single-authority pointer→cell resolver a
 *  touch tap routes through. Its JOB is to delegate to xterm's own (already
 *  transform-corrected) `_core._mouseCoordsService.getCoords`, hand back a
 *  0-based cell, and degrade to null rather than throw. The transform-CORRECTNESS
 *  under zoom lives in `unscaleEventPoint` above (pinned there) and in the
 *  end-to-end `canvas-selection.feature` + the PR-2 tap-under-zoom scenario; here
 *  we pin the delegation, the 1-based→0-based conversion, and the null-degrade,
 *  so a future edit can't silently re-hand-roll the divisor or drop a guard. */
describe("cellAtPoint", () => {
  type GetCoords = (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;

  /** Minimal xterm stand-in exposing only what `cellAtPoint` reaches: the
   *  private `_core._mouseCoordsService.getCoords`, a `.xterm-screen` under
   *  `element`, and `cols`/`rows`. */
  const makeTerm = (
    getCoords: GetCoords | null,
    opts: { noElement?: boolean } = {},
  ): XTerm => {
    const screen = { tagName: "DIV" } as unknown as HTMLElement;
    const element = {
      querySelector: (sel: string) => (sel === ".xterm-screen" ? screen : null),
    } as unknown as HTMLElement;
    return {
      element: opts.noElement ? undefined : element,
      cols: 80,
      rows: 24,
      _core: {
        _mouseCoordsService: getCoords ? { getCoords } : undefined,
      },
    } as unknown as XTerm;
  };

  it("returns the 0-based cell the authority reports (1-based → 0-based)", () => {
    const term = makeTerm(() => [12, 5]); // xterm's 1-based col/row
    expect(cellAtPoint(term, 100, 50)).toEqual({ col: 11, row: 4 });
  });

  it("hands the authority the raw point, the .xterm-screen, and the grid size — as a point hit (isSelection omitted)", () => {
    const calls: Array<{
      event: { clientX: number; clientY: number };
      element: HTMLElement;
      cols: number;
      rows: number;
      isSelection?: boolean;
    }> = [];
    const term = makeTerm((event, element, cols, rows, isSelection) => {
      calls.push({ event, element, cols, rows, isSelection });
      return [1, 1];
    });
    const screen = (term.element as HTMLElement).querySelector(".xterm-screen");
    cellAtPoint(term, 7, 9);
    expect(calls).toHaveLength(1);
    const s = calls[0];
    if (!s) throw new Error("expected one getCoords call");
    expect(s.event).toEqual({ clientX: 7, clientY: 9 });
    expect(s.element).toBe(screen);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
    // A tap is a point hit, not a selection endpoint — no half-cell precision.
    expect(s.isSelection).toBeUndefined();
  });

  it("degrades to null when the mouse-coords service is absent", () => {
    expect(cellAtPoint(makeTerm(null), 1, 1)).toBeNull();
  });

  it("degrades to null when the authority can't map the point", () => {
    expect(
      cellAtPoint(
        makeTerm(() => undefined),
        1,
        1,
      ),
    ).toBeNull();
  });

  it("degrades to null when there is no element / .xterm-screen", () => {
    expect(
      cellAtPoint(
        makeTerm(() => [1, 1], { noElement: true }),
        1,
        1,
      ),
    ).toBeNull();
  });
});

describe("clearWriteQueue", () => {
  it("empties a complete WriteBuffer stand-in", () => {
    const wb = {
      _writeBuffer: ["stale", "bytes"] as unknown[],
      _callbacks: [() => {}, undefined] as unknown[],
      _pendingData: 11,
      _bufferOffset: 0,
    };
    const term = { _core: { _writeBuffer: wb } } as unknown as XTerm;
    clearWriteQueue(term);
    expect(wb._writeBuffer).toEqual([]);
    expect(wb._callbacks).toEqual([]);
    expect(wb._pendingData).toBe(0);
    expect(wb._bufferOffset).toBe(0);
  });

  it("throws when the private shape is missing", () => {
    const term = { _core: {} } as unknown as XTerm;
    expect(() => clearWriteQueue(term)).toThrow(/WriteBuffer private shape/);
  });
});
