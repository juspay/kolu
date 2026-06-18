import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL, waitForBufferContains } from "../support/buffer.ts";
import type { KoluWorld } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const LEFT = "L".repeat(30);
const RIGHT = "R".repeat(30);
/** One terminal row: 30 "L" cells then 30 "R" cells. */
const MARKER = LEFT + RIGHT;
/** First "R" column (0-based) — i.e. the left/right boundary. */
const BOUNDARY = LEFT.length;
/** Print the marker as a tall block of identical rows. The zoom hit-test
 *  offset is 2D — it shifts the selected row as well as the column — so a
 *  single marker row would let the (vertically) offset selection miss it and
 *  land on blank cells. A block guarantees the offset row is still a marker
 *  row, so the bug surfaces as right-half "R" cells (illustrative) rather than
 *  an ambiguous empty selection. */
const MARKER_ROWS = 15;

type CellPixel = { x: number; y: number } | null;

/** Visual pixel centre of terminal column `col` on the FIRST marker row,
 *  derived from the post-transform `.xterm-screen` rect via
 *  `rect.width / term.cols` — the same transform-correct cell mapping kolu's
 *  touch hit-testing uses (`Terminal.tsx` `fileRefAtPoint`) and the file-ref
 *  e2e step. Reflects whatever zoom is live, so it is the "ground truth" a
 *  user sees. Null when no marker row is found / measurable. */
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
        const cellW = rect.width / term.cols;
        const cellH = rect.height / term.rows;
        return {
          x: rect.left + (targetCol + 0.5) * cellW,
          y: rect.top + (row - top + 0.5) * cellH,
        };
      }
      return null;
    },
    { sel: ACTIVE_TERMINAL, marker: MARKER, targetCol: col },
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
    await this.terminalRun(`yes ${MARKER} | head -n ${MARKER_ROWS}`);
    await waitForBufferContains(this.page, MARKER);
    await this.waitForFrame();
  },
);

When(
  "I zoom the canvas in toward the marker block",
  async function (this: KoluWorld) {
    // Anchor the ctrl+wheel zoom on the marker itself so the first marker row
    // stays under the cursor (zoomTowardPoint keeps the cursor point fixed) —
    // the drag pixels can't be clipped out of view by the zoom.
    const anchor = await markerCellPixel(this, Math.floor(BOUNDARY / 2));
    assert.ok(anchor, "marker block not found before zoom");
    // Playwright's mouse.wheel can't carry ctrlKey, so dispatch the WheelEvent
    // directly (matching canvas.feature's zoom step). deltaY -300 → factor
    // 1 - (-300)*0.002 = 1.6, so zoom goes 1.0 → 1.6.
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
    // Smallest left-half visual column whose *uncorrected* (zoom-offset) image
    // lands in the right half: ceil((vs + 0.5) * z) >= BOUNDARY. +1 for margin.
    const vs = Math.ceil(BOUNDARY / z - 0.5) + 1;
    const ve = BOUNDARY - 2; // stay safely inside the L half
    assert.ok(
      vs <= ve,
      `canvas zoom ${z} too low to separate halves (vs=${vs}, ve=${ve})`,
    );
    const start = await markerCellPixel(this, vs);
    const end = await markerCellPixel(this, ve);
    assert.ok(start && end, "marker block not found after zoom");
    // Both endpoints sit on the same visual row (horizontal drag), so a correct
    // hit-test selects only "L" cells; the zoom offset shifts both to the right
    // half (and down a row, still within the block) → "R" cells.
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
