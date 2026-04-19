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
/** Pill-tree branch entries (one per terminal) — the canonical "list of
 *  terminals" affordance. */
export const PILL_TREE_ENTRY_SELECTOR = '[data-testid="pill-tree-branch"]';
/** Per-tile elements on the canvas — one per top-level terminal. Mobile
 *  uses the mobile-tile-view body to enumerate terminals instead. */
export const CANVAS_TILE_SELECTOR = '[data-testid="canvas-tile"]';

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
  savedPillTreeCount?: number;
  savedActiveTerminalId?: string;
  savedScrollTop?: number;
  savedVisibleText?: string;
  snapshotCols?: Record<string, number>;
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
    // The focused tile is the one user input lands in. With multiple
    // visible canvas tiles, `[data-focused]` resolves to the single tile
    // that owns keyboard focus — clicking + asserting on the active
    // terminal lines up with what the user sees.
    return this.page.locator("[data-focused] .xterm-screen").first();
  }

  /** Create a terminal via the keyboard shortcut (`Cmd/Ctrl+Enter`). Works
   *  uniformly on desktop and mobile — there is no longer a "+" button on
   *  any surface; the shortcut and the command palette are the only paths.
   *  Returns the new terminal's ID. */
  async createTerminal(timeout = READY_TIMEOUT): Promise<string> {
    // Wait for app to settle (onMount may still be restoring terminals from server)
    const settled = this.page.locator(SETTLED_SELECTOR);
    await settled.first().waitFor({ state: "visible", timeout });

    // Snapshot known ids before the shortcut fires.
    const beforeIds = await this.terminalIds();

    await this.page.keyboard.press(`${MOD_KEY}+Enter`);

    // Poll until a new id shows up.
    await this.page.waitForFunction(
      (prev) => {
        const nodes = Array.from(
          document.querySelectorAll("[data-terminal-id]"),
        );
        const ids = new Set(
          nodes
            .map((n) => n.getAttribute("data-terminal-id"))
            .filter((id): id is string => !!id),
        );
        for (const id of ids) {
          if (!prev.includes(id)) return true;
        }
        return false;
      },
      beforeIds,
      { timeout },
    );

    const afterIds = await this.terminalIds();
    const newId = afterIds.find((id) => !beforeIds.includes(id));
    if (!newId) throw new Error("Created terminal but no new id appeared");

    await this.canvas.waitFor({ state: "visible", timeout });
    // Wait for xterm's textarea to receive focus (auto-focus in Terminal.tsx onMount)
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-visible]"),
      { timeout },
    );
    return newId;
  }

  /** All terminal ids currently present in the DOM (canvas tiles, mobile
   *  pager entries, and pill-tree branches all carry `data-terminal-id`). */
  async terminalIds(): Promise<string[]> {
    return this.page.evaluate(() => {
      const seen = new Set<string>();
      for (const n of document.querySelectorAll("[data-terminal-id]")) {
        const id = n.getAttribute("data-terminal-id");
        if (id) seen.add(id);
      }
      return [...seen];
    });
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
