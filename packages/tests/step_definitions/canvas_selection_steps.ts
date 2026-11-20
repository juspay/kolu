import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import type { KoluWorld } from "../support/world.ts";
import { POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const MARKER_ROWS = 15;

type MarkerBlock = { line: string; boundary: number };

const printedMarker = new WeakMap<KoluWorld, MarkerBlock>();

function markerOf(world: KoluWorld): MarkerBlock {
  const block = printedMarker.get(world);
  assert.ok(block, "no marker block has been printed in this scenario");
  return block;
}

type CellPixel = { x: number; y: number } | null;

async function markerCellPixel(
  world: KoluWorld,
  col: number,
): Promise<CellPixel> {
  return world.page.evaluate(
    ({ sel, marker, targetCol }) => {
      type Line = { translateToString(trim?: boolean): string };
      type XtermLike = {
        cols: number;
        rows: number;
        buffer: {
          active: { viewportY: number; getLine(i: number): Line | undefined };
        };
      };
      const container = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: XtermLike })
        | null;
      const term = container?.__xterm;
      const screen = container?.querySelector(".xterm-screen");
      if (!container || !term || !screen) return null;
      const { active } = term.buffer;
      const top = active.viewportY;
      for (let row = top; row < top + term.rows; row++) {
        const text = active.getLine(row)?.translateToString(true) ?? "";
        if (text.trim() !== marker) continue;
        const rect = screen.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const cellW = rect.width / term.cols;
        const cellH = rect.height / term.rows;
        return {
          x: rect.left + (targetCol + 0.5) * cellW,
          y: rect.top + (row - top + 0.5) * cellH,
        };
      }
      return null;
    },
    { sel: ACTIVE_TERMINAL, marker: markerOf(world).line, targetCol: col },
  );
}

async function canvasZoom(world: KoluWorld): Promise<number> {
  return world.page.evaluate(
    (sel) =>
      parseFloat(document.querySelector(sel)?.getAttribute("data-zoom") ?? "1"),
    CANVAS_SELECTOR,
  );
}

When(
  "I print a marker block in the terminal",
  async function (this: KoluWorld) {
    const cols = await this.page.evaluate((sel) => {
      const c = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: { cols: number } })
        | null;
      return c?.__xterm?.cols ?? 0;
    }, ACTIVE_TERMINAL);
    assert.ok(
      cols >= 30,
      `terminal too narrow for the marker test (cols=${cols})`,
    );
    const boundary = Math.floor((cols - 2) / 2);
    const line = "L".repeat(boundary) + "R".repeat(boundary);
    printedMarker.set(this, { line, boundary });
    await this.terminalRun(`yes ${line} | head -n ${MARKER_ROWS}`);
    await this.page.waitForFunction(
      ({ sel, marker }) => {
        type Line = { translateToString(trim?: boolean): string };
        const c = document.querySelector(sel) as
          | (HTMLElement & {
              __xterm?: {
                rows: number;
                buffer: {
                  active: {
                    viewportY: number;
                    getLine(i: number): Line | undefined;
                  };
                };
              };
            })
          | null;
        const term = c?.__xterm;
        if (!term) return false;
        const top = term.buffer.active.viewportY;
        for (let r = top; r < top + term.rows; r++) {
          const text =
            term.buffer.active.getLine(r)?.translateToString(true) ?? "";
          if (text.trim() === marker) return true;
        }
        return false;
      },
      { sel: ACTIVE_TERMINAL, marker: markerOf(this).line },
      { timeout: POLL_TIMEOUT },
    );
    await this.waitForFrame();
  },
);

When(
  "I zoom the canvas in toward the marker block",
  async function (this: KoluWorld) {
    const { boundary } = markerOf(this);
    const anchor = await markerCellPixel(this, Math.floor(boundary / 2));
    assert.ok(anchor, "marker block not found before zoom");
    await this.page.evaluate(
      ({ sel, x, y }) => {
        document.querySelector(sel)?.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -300,
            ctrlKey: true,
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
      },
      { sel: CANVAS_SELECTOR, x: anchor.x, y: anchor.y },
    );
    await this.waitForFrame();
    const zoom = await canvasZoom(this);
    assert.ok(
      zoom >= 1.5,
      `expected canvas zoom >= 1.5 to surface the hit-test offset, got ${zoom}`,
    );
  },
);

When(
  "I drag-select a visual span in the left half of the marker block",
  async function (this: KoluWorld) {
    const z = await canvasZoom(this);
    const { boundary } = markerOf(this);
    const vs = Math.ceil(boundary / z - 0.5) + 1;
    const ve = boundary - 2;
    assert.ok(
      vs <= ve,
      `canvas zoom ${z} too low to separate halves (vs=${vs}, ve=${ve}, boundary=${boundary})`,
    );
    const start = await markerCellPixel(this, vs);
    const end = await markerCellPixel(this, ve);
    assert.ok(start && end, "marker block not found after zoom");
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 12 });
    await this.page.mouse.up();
    await this.waitForFrame();
  },
);

Then(
  "the terminal selection should contain only left-half characters",
  async function (this: KoluWorld) {
    const selection = await this.page.evaluate((sel) => {
      const c = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: { getSelection(): string } })
        | null;
      return c?.__xterm?.getSelection() ?? "";
    }, ACTIVE_TERMINAL);
    const trimmed = selection.trim();
    assert.ok(
      trimmed.length >= 3,
      `expected a non-empty selection under the pointer, got ${JSON.stringify(selection)}`,
    );
    assert.ok(
      /^L+$/.test(trimmed),
      `selection landed off the pointer (zoom hit-test offset, #1400): ` +
        `expected only left-half "L" cells, got ${JSON.stringify(trimmed)}`,
    );
  },
);
