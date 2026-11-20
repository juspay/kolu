import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { padiCall } from "../support/rpcWire.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

const tileSelector = (sel: string, tileId: string) =>
  `${sel} [data-testid="canvas-tile"][data-terminal-id="${tileId}"]`;

const setCanvasLayout = (
  id: string,
  layout: { x: number; y: number; w: number; h: number },
): Promise<unknown> => padiCall("chrome/setCanvasLayout", { id, layout });

When(
  "I resize created terminal {int} to width {int} and height {int}",
  async function (this: KoluWorld, index: number, w: number, h: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
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
    await setCanvasLayout(id, { x: current.x, y: current.y, w, h });
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
