/**
 * Cucumber World — holds Playwright page + terminal helpers.
 *
 * One instance per scenario. Browser context created in hooks.ts.
 */

import {
  World,
  setWorldConstructor,
  setDefaultTimeout,
} from "@cucumber/cucumber";
import type { Browser, BrowserContext, Page, Locator } from "playwright";

setDefaultTimeout(60_000);

const REFLOW_SETTLE_MS = 1000;
const READY_TIMEOUT = 15_000;

export class KoluWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;

  // Collected page errors
  errors: string[] = [];

  // Stashed dimensions for comparison across steps
  savedCanvas?: { x: number; y: number; width: number; height: number };
  previousCanvas?: { x: number; y: number; width: number; height: number };
  savedFontSize?: number;

  // HTTP response from last request
  lastResponseText?: string;
  lastResponseOk?: boolean;

  // --- Canvas locator ---

  get canvas(): Locator {
    return this.page.locator("canvas");
  }

  // --- Terminal helpers (same logic as old DSL) ---

  async waitForReady(timeout = READY_TIMEOUT) {
    await this.canvas.waitFor({ state: "visible", timeout });
  }

  async terminalType(text: string) {
    await this.page.keyboard.type(text);
  }

  async terminalEnter() {
    await this.page.keyboard.press("Enter");
  }

  async terminalRun(command: string) {
    await this.terminalType(command);
    await this.terminalEnter();
  }

  async canvasBox() {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error("Canvas has no bounding box");
    return box;
  }

  async containerBox() {
    const container = this.page.locator("[data-font-size]");
    const box = await container.boundingBox();
    if (!box) throw new Error("Container has no bounding box");
    return box;
  }

  async resizeViewport(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    await this.page.waitForTimeout(REFLOW_SETTLE_MS);
  }

  async zoomIn() {
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.press(`${mod}+Equal`);
    await this.page.waitForTimeout(300);
  }

  async zoomOut() {
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.press(`${mod}+Minus`);
    await this.page.waitForTimeout(300);
  }

  async fontSize(): Promise<number> {
    const container = this.page.locator("[data-font-size]");
    const val = await container.getAttribute("data-font-size");
    if (!val) throw new Error("No data-font-size attribute found");
    return parseFloat(val);
  }
}

setWorldConstructor(KoluWorld);
