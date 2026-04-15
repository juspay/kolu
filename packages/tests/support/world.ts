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

setDefaultTimeout(30_000);

const READY_TIMEOUT = 10_000;
/** Shared timeout for element polling (waitFor / waitForFunction). Generous for darwin CI under load. */
export const POLL_TIMEOUT = 10_000;
export const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

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
  savedSessionTerminalCount?: number;
  savedSessionTerminals?: import("kolu-common").SavedTerminal[];
  savedCanvas?: { x: number; y: number; width: number; height: number };
  previousCanvas?: { x: number; y: number; width: number; height: number };
  savedFontSize?: number;
  lastResponseText?: string;
  lastResponseOk?: boolean;
  terminalCountBeforeRefresh?: number;
  savedSidebarCount?: number;
  savedActiveTerminalId?: string;
  savedScrollTop?: number;
  savedVisibleText?: string;
  _scrollFifo?: string;
  createdTerminalIds: string[] = [];
  shuffleHistory: string[] = [];

  /** Wait for a double-rAF — ensures SolidJS reactivity + Corvu transitions have been flushed. */
  async waitForFrame() {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  get canvas(): Locator {
    return this.page.locator("[data-visible] .xterm-screen");
  }

  /** Click the sidebar "+" button to create a terminal, then wait for its canvas and focus. Returns terminal ID. */
  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    // Wait for app to settle (onMount may still be restoring terminals from server)
    const settled = this.page.locator(SETTLED_SELECTOR);
    await settled.first().waitFor({ state: "visible", timeout });

    // On mobile (@mobile tag) the sidebar starts collapsed (`-translate-x-full`)
    // so the create button sits at a negative x. `isVisible()` doesn't catch
    // this — translated-offscreen elements still have a non-empty bounding box.
    // Check the actual x coordinate and click the hamburger if needed.
    const createBtn = this.page.locator('[data-testid="create-terminal"]');
    const box = await createBtn.boundingBox();
    if (!box || box.x < 0) {
      // Mobile: header burger, desktop: status bar button
      const mobile = this.page.locator('[data-testid="sidebar-toggle"]');
      const toggle = (await mobile.isVisible())
        ? mobile
        : this.page.locator('[data-testid="sidebar-toggle-desktop"]');
      await toggle.click();
      await this.page.waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="create-terminal"]');
          if (!btn) return false;
          const r = btn.getBoundingClientRect();
          return r.x >= 0;
        },
        { timeout },
      );
    }

    // Note the last sidebar entry before creating, so we can identify the new one
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    const countBefore = await entries.count();

    await createBtn.click();

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
      { timeout },
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
    // Wait for layout reflow and xterm.js fit to settle
    await this.waitForFrame();
    await this.waitForFrame();
  }

  async zoomIn() {
    await this.page.keyboard.press(`${MOD_KEY}+Equal`);
    await this.waitForFrame();
  }

  async zoomOut() {
    await this.page.keyboard.press(`${MOD_KEY}+Minus`);
    await this.waitForFrame();
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
