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

  /** Create a terminal and wait for its canvas + focus. Returns the new ID.
   *  Uses the sidebar "+" button when available; falls back to the keyboard
   *  shortcut in canvas layout (where no sidebar is rendered). */
  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    // Wait for app to settle (onMount may still be restoring terminals from server)
    const settled = this.page.locator(SETTLED_SELECTOR);
    await settled.first().waitFor({ state: "visible", timeout });

    // Count any existing terminal tiles so we can identify the new one
    // whether it appears in the sidebar (compact) or the canvas (canvas).
    const anyTileSelector = "[data-terminal-id]";
    const idsBefore = await this.page
      .locator(anyTileSelector)
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.terminalId ?? ""),
      );
    const beforeSet = new Set(idsBefore);

    const createBtn = this.page.locator('[data-testid="create-terminal"]');
    const btnCount = await createBtn.count();
    if (btnCount === 0) {
      // Canvas layout — no compact dock rendered. Use the keyboard shortcut
      // which works in any layout (both Cmd+T and Cmd+Enter are registered).
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await this.page.keyboard.press(`${mod}+KeyT`);
    } else {
      // On mobile (@mobile tag) the sidebar starts collapsed (`-translate-x-full`)
      // so the create button sits at a negative x. `isVisible()` doesn't catch
      // this — translated-offscreen elements still have a non-empty bounding box.
      // Check the actual x coordinate and click the hamburger if needed.
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
            const btn = document.querySelector(
              '[data-testid="create-terminal"]',
            );
            if (!btn) return false;
            const r = btn.getBoundingClientRect();
            return r.x >= 0;
          },
          { timeout },
        );
      }
      await createBtn.click();
    }

    // Wait for a new [data-terminal-id] to appear — works in either layout
    // (sidebar entry in compact, canvas tile in canvas).
    const rawId = await this.page.waitForFunction(
      ({ before }: { before: string[] }) => {
        const seen = new Set(before);
        const els = document.querySelectorAll("[data-terminal-id]");
        for (const el of els) {
          const id = (el as HTMLElement).dataset.terminalId;
          if (id && !seen.has(id)) return id;
        }
        return null;
      },
      { before: [...beforeSet] },
      { timeout },
    );
    const id = await rawId.jsonValue();
    if (!id || typeof id !== "string")
      throw new Error("Created terminal has no data-terminal-id");

    // In canvas layout multiple tiles are `[data-visible]` at once, so the
    // locator resolves to many — `.first()` picks any visible xterm screen.
    await this.canvas.first().waitFor({ state: "visible", timeout });
    // Wait for xterm's textarea to receive focus (auto-focus in Terminal.tsx onMount)
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-visible]"),
      { timeout },
    );
    return id;
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
