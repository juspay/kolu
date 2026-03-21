/**
 * Cucumber World — holds Playwright page + terminal helpers.
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
const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

export class KoluWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  errors: string[] = [];

  // Stashed state for comparison across steps
  savedCanvas?: { x: number; y: number; width: number; height: number };
  previousCanvas?: { x: number; y: number; width: number; height: number };
  savedFontSize?: number;
  lastResponseText?: string;
  lastResponseOk?: boolean;

  get canvas(): Locator {
    return this.page.locator("canvas");
  }

  async waitForReady(timeout = READY_TIMEOUT) {
    await this.canvas.waitFor({ state: "visible", timeout });
  }

  async terminalRun(command: string) {
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
  }

  async canvasBox() {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error("Canvas has no bounding box");
    return box;
  }

  async containerBox() {
    const box = await this.page.locator("[data-font-size]").boundingBox();
    if (!box) throw new Error("Container has no bounding box");
    return box;
  }

  async resizeViewport(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    await this.page.waitForTimeout(REFLOW_SETTLE_MS);
  }

  async zoomIn() {
    await this.page.keyboard.press(`${MOD_KEY}+Equal`);
    await this.page.waitForTimeout(300);
  }

  async zoomOut() {
    await this.page.keyboard.press(`${MOD_KEY}+Minus`);
    await this.page.waitForTimeout(300);
  }

  async fontSize(): Promise<number> {
    const val = await this.page
      .locator("[data-font-size]")
      .getAttribute("data-font-size");
    if (!val) throw new Error("No data-font-size attribute found");
    return parseFloat(val);
  }
}

setWorldConstructor(KoluWorld);
