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

import type { ITerminalOptions, Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  cellAtPoint,
  clearWriteQueue,
  measuredCharWidth,
  unscaleEventPoint,
} from "./internals";
import { measureGridBox } from "./solid/measureBox";

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

  it("drops scheduled writes on the shipped @xterm/xterm so they never parse after reset", async () => {
    // Pin the contamination race clearPendingOutput exists for: queue stale
    // bytes, clear the write queue + reset, write fresh, await parse — only
    // fresh content remains and the dropped stale callback never fires.
    const { Terminal: XTermCtor } = await import("@xterm/xterm");
    const term = new XTermCtor({
      cols: 40,
      rows: 10,
      scrollback: 10,
      allowProposedApi: true,
    });
    try {
      let staleCb = 0;
      // Queue without awaiting — leave chunks on WriteBuffer's async path.
      term.write("STALE_SHOULD_NOT_LAND", () => {
        staleCb++;
      });
      clearWriteQueue(term);
      term.reset();
      await new Promise<void>((resolve) =>
        term.write("FRESH_ONLY", () => resolve()),
      );
      // Allow any timer that might have been scheduled before clear to fire.
      await new Promise((r) => setTimeout(r, 30));
      expect(staleCb, "dropped stale write callback must not fire").toBe(0);
      const line0 = (
        term as unknown as {
          _core: {
            buffers: {
              normal: {
                lines: {
                  get(i: number): { translateToString(t: boolean): string };
                };
              };
            };
          };
        }
      )._core.buffers.normal.lines
        .get(0)
        .translateToString(true);
      expect(line0).toContain("FRESH_ONLY");
      expect(line0).not.toContain("STALE");
    } finally {
      term.dispose();
    }
  });
});

/**
 * CONTRACT PIN — xterm resize parses the write queue at the *old* cols before
 * reflowing (`WriteBuffer.flushSyncAttempt()`). applyFit's coalesce.flush()
 * before fit() is only correct because of this ordering: flush only
 * term.write()s (async); if a future @xterm/xterm beta dropped the flush from
 * resize, old-grid bytes would parse after reflow and the multi-tile coalesce
 * resize fix would silently become a no-op. Name of the failure is the contract.
 *
 * The flush stops at a chunk whose async parser handler is pending (the
 * client's ImageAddon decoding an image): what follows it parses after the
 * reflow, and parsing must carry on. Before xtermjs/xterm.js#6327 the resize
 * threw "improper continuation" there and the terminal stopped parsing for good.
 */
describe("CONTRACT PIN — @xterm/xterm resize parses write queue at old cols before reflow", () => {
  function lineText(term: XTerm, row: number): string {
    return (
      term as unknown as {
        _core: {
          buffers: {
            normal: {
              lines: {
                get(i: number): { translateToString(trim: boolean): string };
              };
            };
          };
        };
      }
    )._core.buffers.normal.lines
      .get(row)
      .translateToString(true);
  }

  it("drains a still-queued write at the pre-resize width (flush before reflow)", async () => {
    const { Terminal: XTermCtor } = await import("@xterm/xterm");
    const term = new XTermCtor({
      cols: 80,
      rows: 10,
      scrollback: 10,
      allowProposedApi: true,
    });
    try {
      // 80×'A' + 'B' wraps at 80 cols (B on next line) but fits on one line at 120.
      const payload = `${"A".repeat(80)}B`;
      let parsed = false;
      // Queue without awaiting — leave the chunk on WriteBuffer's async path so
      // only resize's flush can land it before cols change.
      term.write(payload, () => {
        parsed = true;
      });
      expect(
        parsed,
        "precondition: write must still be queued before resize (async path)",
      ).toBe(false);

      term.resize(120, 10);

      expect(
        parsed,
        "@xterm/xterm resize must parse the write queue before reflow — " +
          "applyFit coalesce.flush()→term.write depends on this; without it, " +
          "old-grid unfocused bytes parse after cols change",
      ).toBe(true);

      const line0 = lineText(term, 0);
      const line1 = lineText(term, 1);
      // Parsed at cols=80 (pre-resize), not at 120: B is wrapped, not on line 0.
      expect(
        line0.length,
        "queued payload must wrap at OLD cols=80 (flush before reflow). " +
          "If this fails, @xterm/xterm likely stopped drain-before-reflow and " +
          "the applyFit coalesce.flush-before-fit fix is a silent no-op.",
      ).toBe(80);
      expect(line0).toBe("A".repeat(80));
      expect(line1).toContain("B");
    } finally {
      term.dispose();
    }
  });

  it("keeps parsing after a resize that lands while an async parser handler is pending", async () => {
    const { Terminal: XTermCtor } = await import("@xterm/xterm");
    const term = new XTermCtor({
      cols: 80,
      rows: 10,
      scrollback: 10,
      allowProposedApi: true,
    });
    try {
      // Stand-in for ImageAddon's async image decode: an OSC handler that
      // holds the parser until the test releases it.
      const decode = Promise.withResolvers<boolean>();
      term.parser.registerOscHandler(1337, () => decode.promise);
      const parsed: string[] = [];
      term.write("\x1b]1337;File=inline=1:AAAA\x07", () =>
        parsed.push("image"),
      );
      term.write("before", () => parsed.push("before"));

      term.resize(40, 10);
      term.write("after", () => parsed.push("after"));
      decode.resolve(true);
      await new Promise<void>((resolve) => term.write("", resolve));

      expect(
        parsed,
        "every write after a resize during a pending async handler must still parse — " +
          "on the beta before xtermjs/xterm.js#6327 the resize gave up parsing here",
      ).toEqual(["image", "before", "after"]);
      expect(lineText(term, 0)).toBe("beforeafter");
    } finally {
      term.dispose();
    }
  });
});

// ── A real browser xterm, under happy-dom ──────────────────────────────────
//
// The pins below ask their questions of an actual `@xterm/xterm` rather than a
// stand-in, because what they pin is what the shipped library DOES: the
// measurement it keeps, the cell height it derives, the scrollbar it reserves.
// happy-dom ships no canvas, so one 2D-context stub with a known `measureText`
// is all the scaffolding needed to open one.
/** The width `measureText('W')` answers — FiraCode Nerd Font at 14px, the
 *  measurement kolu's own terminals produce in Chromium. Deliberately not a
 *  whole number: the two renderers differ precisely in what they round it to. */
const MEASURED_WIDTH = 8.6154;
const MEASURED_ASCENT = 13;
const MEASURED_DESCENT = 4.6;

/** Enough 2D-context surface for xterm to open under happy-dom, which ships
 *  no canvas: the char measure (`measureText`) and the DOM renderer's width
 *  cache (everything else). */
function stubContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 100, height: 100 },
    font: "",
    textBaseline: "",
    fillStyle: "",
    measureText: () => ({
      width: MEASURED_WIDTH,
      fontBoundingBoxAscent: MEASURED_ASCENT,
      fontBoundingBoxDescent: MEASURED_DESCENT,
      actualBoundingBoxAscent: MEASURED_ASCENT,
      actualBoundingBoxDescent: MEASURED_DESCENT,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: MEASURED_WIDTH,
    }),
    fillText: () => {},
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4 * 100 * 100) }),
    putImageData: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    scale: () => {},
    translate: () => {},
  } as unknown as CanvasRenderingContext2D;
}

/** A REAL `@xterm/xterm`, opened into a host element on that stub — the one
 *  harness every pin below asks its question of. */
async function openTerminal(options: ITerminalOptions = {}) {
  (
    HTMLCanvasElement.prototype as unknown as { getContext: unknown }
  ).getContext = () => stubContext();
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas =
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      public getContext(): CanvasRenderingContext2D {
        return stubContext();
      }
    };
  // Imported here, not at the top: `CharSizeService` picks its measure
  // strategy from the globals present when the module loads, so the stubs
  // above must be installed first for it to measure rather than fall back.
  const { Terminal: XTermCtor } = await import("@xterm/xterm");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const term = new XTermCtor({
    cols: 80,
    rows: 24,
    allowProposedApi: true,
    ...options,
  });
  term.open(host);
  return { term, host };
}

/**
 * CONTRACT PIN — `_core._charSizeService.width` is xterm's own UNROUNDED
 * character measurement, and it is the number kolu sizes every terminal with
 * (`solid/measureBox.ts` → `solid/grid.ts`). A beta that renames the service or
 * stops publishing a numeric `width` must fail HERE, loudly, rather than at a
 * user's tile: `measuredCharWidth` throws, so an unpinned rename would stop
 * every pane measuring — no grid, no attach, no output.
 *
 * The terminal is opened on a canvas stub whose `measureText` answers a known
 * width, so the whole path is pinned: the service exists after `open()`, it
 * keeps what the font measurement said, and the accessor reads THAT rather
 * than something a renderer has already rounded.
 */
describe("CONTRACT PIN — @xterm/xterm exposes its unrounded char measurement", () => {
  it("hands back the font measurement itself, not a renderer's rounding of it", async () => {
    const { term, host } = await openTerminal();
    try {
      expect(measuredCharWidth(term)).toBe(MEASURED_WIDTH);
      // The attached DOM renderer re-derives its CSS cell width from a ROUNDED
      // canvas width, so even the renderer kolu's columns agree with does not
      // report this number. Sizing off `dimensions` would therefore drift with
      // the column count — and off the WebGL renderer it drifts much further,
      // which is the resize-on-renderer-swap bug this accessor removes.
      expect(term.dimensions?.css.cell.width).not.toBe(MEASURED_WIDTH);
    } finally {
      term.dispose();
      host.remove();
    }
  });

  it("pins the cell HEIGHT both renderers compute, as a whole device pixel", async () => {
    const { term, host } = await openTerminal();
    try {
      // Both `_updateDimensions` implementations run the same chain:
      // ceil(charHeight × dpr) × lineHeight, floored. Rows are computed from
      // this integer, never from the DOM renderer's css.cell.height (which it
      // re-derives from a rounded canvas height and which therefore depends on
      // the row count).
      const deviceCellHeight = term.dimensions?.device.cell.height;
      expect(deviceCellHeight).toBe(
        Math.ceil(
          (MEASURED_ASCENT + MEASURED_DESCENT) * window.devicePixelRatio,
        ),
      );
      expect(Number.isInteger(deviceCellHeight)).toBe(true);
    } finally {
      term.dispose();
      host.remove();
    }
  });

  it("throws when the private shape is missing", () => {
    const term = { _core: {} } as unknown as XTerm;
    expect(() => measuredCharWidth(term)).toThrow(/CharSizeService/);
  });
});

/**
 * CONTRACT PIN — the scrollbar width kolu reserves is the one xterm RENDERS.
 *
 * `solid/measureBox.ts` subtracts a vertical scrollbar from the available
 * width, following `Viewport._getChangeOptions()`: hidden → 0, else
 * `scrollbar.width` or xterm's own default of 14. `@xterm/addon-fit` could
 * `import { ViewportConstants }` for that default; kolu cannot reach it from
 * outside the bundle, so the number is a COPY — and a copy that goes stale
 * costs a terminal one or two columns too wide, with its last cells sitting
 * under the scrollbar.
 *
 * So it is not asserted against itself: the test opens a real terminal and
 * compares what `measureGridBox` reserves against the width xterm actually
 * gives its vertical scrollbar element. All three branches of the rule are
 * exercised, so an upstream change to the default, to the option name, or to
 * the hidden case fails here.
 */
describe("CONTRACT PIN — @xterm/xterm reserves the scrollbar width kolu subtracts", () => {
  /** The width xterm's rendered vertical scrollbar occupies, in CSS px.
   *  `AbstractScrollbar._renderDomNode` writes it as an inline style, which is
   *  the only place a layout-free DOM can be asked. */
  function renderedScrollbarWidth(host: HTMLElement): number {
    const bar = host.querySelector<HTMLElement>(
      ".xterm-scrollbar.xterm-vertical",
    );
    if (!bar) throw new Error("xterm rendered no vertical scrollbar element");
    return Number.parseFloat(bar.style.width);
  }

  it.each([
    { label: "by default", options: {}, expected: 14 },
    {
      label: "with an explicit scrollbar width",
      options: { scrollbar: { width: 22 } },
      expected: 22,
    },
    {
      label: "with the scrollbar switched off",
      options: { scrollbar: { showScrollbar: false } },
      expected: 0,
    },
  ])("reserves what it renders $label", async ({ options, expected }) => {
    const { term, host } = await openTerminal(options);
    try {
      expect(renderedScrollbarWidth(host)).toBe(expected);
      expect(measureGridBox(term, host)?.scrollbarWidth).toBe(expected);
    } finally {
      term.dispose();
      host.remove();
    }
  });
});
