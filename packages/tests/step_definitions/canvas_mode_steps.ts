import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TOGGLE_SELECTOR = '[data-testid="canvas-mode-toggle"]';
const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

// ── Actions ──

When("I click the canvas mode toggle", async function (this: KoluWorld) {
  const toggle = this.page.locator(TOGGLE_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

// ── Assertions ──

Then(
  "the canvas mode toggle should show {string}",
  async function (this: KoluWorld, label: string) {
    const toggle = this.page.locator(TOGGLE_SELECTOR);
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      ({ sel, expected }: { sel: string; expected: string }) => {
        const el = document.querySelector(sel);
        return el?.textContent?.trim() === expected;
      },
      { sel: TOGGLE_SELECTOR, expected: label },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas mode toggle should not be visible",
  async function (this: KoluWorld) {
    // On mobile, the toggle is hidden via `hidden sm:flex` — check it's not visible
    await this.page.waitForFunction(
      (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return true;
        const style = getComputedStyle(el);
        return style.display === "none";
      },
      TOGGLE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas grid background should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) !== null,
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas grid background should not be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) === null,
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "there should be {int} canvas tile(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }: { sel: string; count: number }) => {
        const bg = document.querySelector(sel);
        if (!bg) return false;
        const tiles = bg.querySelectorAll("[data-terminal-id][data-visible]");
        return tiles.length === count;
      },
      { sel: CANVAS_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas tile should have a title bar",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const bg = document.querySelector(sel);
        if (!bg) return false;
        return bg.querySelector('[data-testid="terminal-meta-name"]') !== null;
      },
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the close button on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    // Canvas tiles each have a close button in the title bar.
    // Find tile containers inside the canvas — each tile is an absolute-positioned
    // div that wraps a [data-terminal-id][data-visible] element.
    const closeButtons = this.page.locator(
      `${CANVAS_SELECTOR} button[title="Close terminal"]`,
    );
    const btn = closeButtons.nth(index - 1);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

Then(
  "the canvas tiles should be visible in the viewport",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const container = document.querySelector(sel);
        if (!container) return false;
        const tile = container.querySelector(
          "[data-terminal-id][data-visible]",
        );
        if (!tile) return false;
        const cRect = container.getBoundingClientRect();
        const tRect = tile.getBoundingClientRect();
        // Tile's top-left corner should be within the visible container area
        return (
          tRect.left >= cRect.left &&
          tRect.top >= cRect.top &&
          tRect.left < cRect.right &&
          tRect.top < cRect.bottom
        );
      },
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// "the close confirmation should be visible" is defined in worktree_steps.ts
