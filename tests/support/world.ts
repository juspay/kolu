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

const REFLOW_SETTLE_MS = 2000;
const READY_TIMEOUT = 15_000;
const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

/** Locator for the app's settled state: either a visible terminal screen or the empty state tip. */
const SETTLED_SELECTOR =
  '[data-visible] .xterm-screen, [data-testid="empty-state"]';
export const SIDEBAR_ENTRY_SELECTOR =
  '[data-testid="sidebar"] [data-terminal-id]';

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
  terminalCountBeforeRefresh?: number;
  savedSidebarCount?: number;
  savedScrollTop?: number;
  savedVisibleText?: string;
  _scrollFifo?: string;
  createdTerminalIds: string[] = [];

  // Demo recording state (used by demo_steps.ts)
  demoInterval?: ReturnType<typeof setInterval>;
  demoFrameNum = 0;

  get canvas(): Locator {
    return this.page.locator("[data-visible] .xterm-screen");
  }

  /** Click the sidebar "+" button to create a terminal, then wait for its canvas and focus. Returns terminal ID. */
  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    // Wait for app to settle (onMount may still be restoring terminals from server)
    const settled = this.page.locator(SETTLED_SELECTOR);
    await settled.first().waitFor({ state: "visible", timeout });

    // Note the last sidebar entry before creating, so we can identify the new one
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    const countBefore = await entries.count();

    await this.page.locator('[data-testid="create-terminal"]').click();

    // Wait for the new entry to appear in the sidebar
    await entries.nth(countBefore).waitFor({ state: "visible", timeout });
    const rawId = await entries
      .nth(countBefore)
      .getAttribute("data-terminal-id");
    if (!rawId) throw new Error("Created terminal has no data-terminal-id");

    await this.canvas.waitFor({ state: "visible", timeout });
    // Wait for xterm's textarea to receive focus (auto-focus in Terminal.tsx onMount)
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-visible]"),
      { timeout: 5000 },
    );
    return rawId;
  }

  /** Wait for the app to reach a stable state (restored terminals or empty state). */
  async waitForSettled(timeout = READY_TIMEOUT) {
    const settled = this.page.locator(SETTLED_SELECTOR);
    await settled.first().waitFor({ state: "visible", timeout });
  }

  /** Wait for the app to settle, creating a terminal if empty state is shown. */
  async waitForReady(timeout = READY_TIMEOUT) {
    await this.waitForSettled(timeout);

    // If the empty state is visible, create a terminal
    if (await this.page.locator('[data-testid="empty-state"]').isVisible()) {
      await this.createTerminal(timeout);
    }
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
    const box = await this.page
      .locator("[data-visible][data-font-size]")
      .boundingBox();
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
      .locator("[data-visible][data-font-size]")
      .getAttribute("data-font-size");
    if (!val) throw new Error("No data-font-size attribute found");
    return parseFloat(val);
  }
}

setWorldConstructor(KoluWorld);
