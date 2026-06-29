import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

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
    const current = await this.page.evaluate(
      ({ sel, tileId }: { sel: string; tileId: string }) => {
        const inner = document.querySelector(
          `${sel} [data-terminal-id="${tileId}"]`,
        );
        const tile = inner?.closest("[style*='left']") as HTMLElement | null;
        if (!tile) throw new Error(`Tile for ${tileId} not found`);
        return {
          x: parseFloat(tile.style.left),
          y: parseFloat(tile.style.top),
        };
      },
      { sel: CANVAS_SELECTOR, tileId: id },
    );
    await setCanvasLayout(this, id, { x: current.x, y: current.y, w, h });
    // Wait for the tile to render at the new size.
    await this.page.waitForFunction(
      ({
        sel,
        tileId,
        wantW,
        wantH,
      }: {
        sel: string;
        tileId: string;
        wantW: number;
        wantH: number;
      }) => {
        const inner = document.querySelector(
          `${sel} [data-terminal-id="${tileId}"]`,
        );
        const tile = inner?.closest("[style*='left']") as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.width) - wantW) < 1 &&
          Math.abs(parseFloat(tile.style.height) - wantH) < 1
        );
      },
      { sel: CANVAS_SELECTOR, tileId: id, wantW: w, wantH: h },
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
      ({ sel, tileId }: { sel: string; tileId: string }) => {
        const tile = document.querySelector(
          `${sel} [data-terminal-id="${tileId}"]`,
        ) as HTMLElement | null;
        if (!tile) throw new Error(`Tile for ${tileId} not found`);
        const rect = tile.getBoundingClientRect();
        tile.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
          }),
        );
      },
      { sel: CANVAS_SELECTOR, tileId: id },
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
        tileId,
        wantW,
        wantH,
      }: {
        sel: string;
        tileId: string;
        wantW: number;
        wantH: number;
      }) => {
        const inner = document.querySelector(
          `${sel} [data-terminal-id="${tileId}"]`,
        );
        const tile = inner?.closest("[style*='left']") as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.width) - wantW) < 1 &&
          Math.abs(parseFloat(tile.style.height) - wantH) < 1
        );
      },
      { sel: CANVAS_SELECTOR, tileId: id, wantW: w, wantH: h },
      { timeout: POLL_TIMEOUT },
    );
  },
);
