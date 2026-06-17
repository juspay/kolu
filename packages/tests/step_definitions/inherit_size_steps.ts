import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

/** Read a canvas tile's rendered dimensions by its 1-based index in
 *  creation order (tracked via `createdTerminalIds` in the world). */
async function getTileDimensions(
  world: KoluWorld,
  index: number,
): Promise<{ w: number; h: number }> {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index} in this scenario`);
  return world.page.evaluate(
    ({ sel, tileId }: { sel: string; tileId: string }) => {
      const inner = document.querySelector(
        `${sel} [data-terminal-id="${tileId}"]`,
      );
      const tile = inner?.closest("[style*='left']") as HTMLElement | null;
      if (!tile) throw new Error(`Tile for ${tileId} not found`);
      return {
        w: parseFloat(tile.style.width),
        h: parseFloat(tile.style.height),
      };
    },
    { sel: CANVAS_SELECTOR, tileId: id },
  );
}

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
  "I resize canvas tile {int} to width {int} and height {int}",
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
  "I resize the active canvas tile to width {int} and height {int}",
  async function (this: KoluWorld, w: number, h: number) {
    // The active tile is the most recently created one (last in createdTerminalIds).
    const index = this.createdTerminalIds.length;
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, "No terminals created in this scenario");
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

Then(
  "canvas tile {int} should have width {int} and height {int}",
  async function (this: KoluWorld, index: number, w: number, h: number) {
    const dims = await getTileDimensions(this, index);
    assert.ok(
      Math.abs(dims.w - w) < 1 && Math.abs(dims.h - h) < 1,
      `Expected tile ${index} to be ${w}×${h}, got ${dims.w}×${dims.h}`,
    );
  },
);
