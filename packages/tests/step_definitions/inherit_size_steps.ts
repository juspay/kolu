import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

/** A canvas tile's positioned element by terminal id. `canvas-tile` is the
 *  same element that carries `data-terminal-id` AND the `left`/`top`/`width`/
 *  `height` inline style (CanvasTile.tsx), so this one selector lands the
 *  positioned tile directly — no `closest("[style*='left']")` hop, which
 *  would substring-match an ancestor's `border-left`/`padding-left` and read
 *  `NaN` geometry. */
const tileSelector = (sel: string, tileId: string) =>
  `${sel} [data-testid="canvas-tile"][data-terminal-id="${tileId}"]`;

/** Set a tile's canvas layout (position + size) via the server RPC. */
async function setCanvasLayout(
  world: KoluWorld,
  id: string,
  layout: { x: number; y: number; w: number; h: number },
): Promise<void> {
  const resp = await world.page.request.fetch("/rpc/terminal/setCanvasLayout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ json: { id, layout } }),
  });
  assert.ok(resp.ok(), `terminal/setCanvasLayout failed: ${resp.status()}`);
}

When(
  "I resize created terminal {int} to width {int} and height {int}",
  async function (this: KoluWorld, index: number, w: number, h: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    // Read current position, keep it, change size.
    const tileSel = tileSelector(CANVAS_SELECTOR, id);
    const current = await this.page.evaluate(
      ({ sel }: { sel: string }) => {
        const tile = document.querySelector(sel) as HTMLElement | null;
        if (!tile) throw new Error(`Tile not found: ${sel}`);
        return {
          x: parseFloat(tile.style.left),
          y: parseFloat(tile.style.top),
        };
      },
      { sel: tileSel },
    );
    await setCanvasLayout(this, id, { x: current.x, y: current.y, w, h });
    // Wait for the tile to render at the new size.
    await this.page.waitForFunction(
      ({
        sel,
        wantW,
        wantH,
      }: {
        sel: string;
        wantW: number;
        wantH: number;
      }) => {
        const tile = document.querySelector(sel) as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.width) - wantW) < 1 &&
          Math.abs(parseFloat(tile.style.height) - wantH) < 1
        );
      },
      { sel: tileSel, wantW: w, wantH: h },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click created terminal {int}",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    // Dispatch mousedown directly (same approach as canvas_steps.ts).
    await this.page.evaluate(
      ({ sel }: { sel: string }) => {
        const tile = document.querySelector(sel) as HTMLElement | null;
        if (!tile) throw new Error(`Tile not found: ${sel}`);
        const rect = tile.getBoundingClientRect();
        tile.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
          }),
        );
      },
      { sel: tileSelector(CANVAS_SELECTOR, id) },
    );
    await this.waitForFrame();
  },
);

Then(
  "created terminal {int} should have width {int} and height {int}",
  async function (this: KoluWorld, index: number, w: number, h: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    // Tile placement and metadata/pending-layout propagation are async, so
    // poll the rendered size instead of reading the DOM once — a single
    // read can race the settle on a slower runner even when the app
    // settles correctly a frame later.
    await this.page.waitForFunction(
      ({
        sel,
        wantW,
        wantH,
      }: {
        sel: string;
        wantW: number;
        wantH: number;
      }) => {
        const tile = document.querySelector(sel) as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.width) - wantW) < 1 &&
          Math.abs(parseFloat(tile.style.height) - wantH) < 1
        );
      },
      { sel: tileSelector(CANVAS_SELECTOR, id), wantW: w, wantH: h },
      { timeout: POLL_TIMEOUT },
    );
  },
);
