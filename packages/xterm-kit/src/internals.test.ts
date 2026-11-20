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
    const r = rect(420, -30, 800, 600);
    expect(unscaleEventPoint(500, 100, r, 800, 600)).toEqual({
      clientX: 500,
      clientY: 100,
    });
  });

  it("inverse-maps a uniform 2x zoom back to logical pixels", () => {
    const r = rect(100, 50, 800, 600);
    const out = unscaleEventPoint(100 + 200, 50 + 120, r, 400, 300);
    expect(out.clientX).toBeCloseTo(200, 9);
    expect(out.clientY).toBeCloseTo(110, 9);
  });

  it("keeps the element's top-left a fixed point under zoom", () => {
    const r = rect(100, 50, 800, 600);
    expect(unscaleEventPoint(100, 50, r, 400, 300)).toEqual({
      clientX: 100,
      clientY: 50,
    });
  });

  it("handles non-uniform scale independently per axis", () => {
    const r = rect(0, 0, 600, 300);
    const out = unscaleEventPoint(300, 150, r, 200, 200);
    expect(out.clientX).toBeCloseTo(100, 9);
    expect(out.clientY).toBeCloseTo(100, 9);
  });

  it("falls back to identity when layout size is 0 (unmeasurable / display:none)", () => {
    const r = rect(0, 0, 0, 0);
    expect(unscaleEventPoint(42, 17, r, 0, 0)).toEqual({
      clientX: 42,
      clientY: 17,
    });
  });

  it("round-trips the documented scale-about-(0,0) forward map", () => {
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
      [r.left, r.top],
      [250, 175],
      [r.left + layoutWidth, r.top + layoutHeight],
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

describe("cellAtPoint", () => {
  type GetCoords = (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;

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
    const term = makeTerm(() => [12, 5]);
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
    const { Terminal: XTermCtor } = await import("@xterm/xterm");
    const term = new XTermCtor({
      cols: 40,
      rows: 10,
      scrollback: 10,
      allowProposedApi: true,
    });
    try {
      let staleCb = 0;
      term.write("STALE_SHOULD_NOT_LAND", () => {
        staleCb++;
      });
      clearWriteQueue(term);
      term.reset();
      await new Promise<void>((resolve) =>
        term.write("FRESH_ONLY", () => resolve()),
      );
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

  it("drains a still-queued write at the pre-resize width (flushSync before reflow)", async () => {
    const { Terminal: XTermCtor } = await import("@xterm/xterm");
    const term = new XTermCtor({
      cols: 80,
      rows: 10,
      scrollback: 10,
      allowProposedApi: true,
    });
    try {
      const payload = `${"A".repeat(80)}B`;
      let parsed = false;
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
        "@xterm/xterm resize must flushSync-parse the write queue before reflow — " +
          "applyFit coalesce.flush()→term.write depends on this; without it, " +
          "old-grid unfocused bytes parse after cols change",
      ).toBe(true);

      const line0 = lineText(term, 0);
      const line1 = lineText(term, 1);
      expect(
        line0.length,
        "queued payload must wrap at OLD cols=80 (flushSync before reflow). " +
          "If this fails, @xterm/xterm likely stopped drain-before-reflow and " +
          "the applyFit coalesce.flush-before-fit fix is a silent no-op.",
      ).toBe(80);
      expect(line0).toBe("A".repeat(80));
      expect(line1).toContain("B");
    } finally {
      term.dispose();
    }
  });
});

const MEASURED_WIDTH = 8.6154;
const MEASURED_ASCENT = 13;
const MEASURED_DESCENT = 4.6;

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

describe("CONTRACT PIN — @xterm/xterm exposes its unrounded char measurement", () => {
  it("hands back the font measurement itself, not a renderer's rounding of it", async () => {
    const { term, host } = await openTerminal();
    try {
      expect(measuredCharWidth(term)).toBe(MEASURED_WIDTH);
      expect(term.dimensions?.css.cell.width).not.toBe(MEASURED_WIDTH);
    } finally {
      term.dispose();
      host.remove();
    }
  });

  it("pins the cell HEIGHT both renderers compute, as a whole device pixel", async () => {
    const { term, host } = await openTerminal();
    try {
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
