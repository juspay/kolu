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
        // Tile should overlap with the visible container area (transformed canvas)
        return (
          tRect.right > cRect.left &&
          tRect.bottom > cRect.top &&
          tRect.left < cRect.right &&
          tRect.top < cRect.bottom
        );
      },
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I zoom the canvas in", async function (this: KoluWorld) {
  // Capture zoom before so we can assert it changed
  const before = await this.page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return parseFloat(el?.getAttribute("data-zoom") ?? "1");
  }, CANVAS_SELECTOR);
  (this as any).__zoomBefore = before;
  const container = this.page.locator(CANVAS_SELECTOR);
  await container.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  // Dispatch a ctrl+wheel event to trigger zoom (negative deltaY = zoom in).
  // Playwright's mouse.wheel doesn't support modifier keys, so we dispatch
  // the WheelEvent directly from the page context.
  await this.page.evaluate(
    ({ sel }: { sel: string }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -300,
          ctrlKey: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        }),
      );
    },
    { sel: CANVAS_SELECTOR },
  );
  await this.waitForFrame();
});

Then(
  "the canvas zoom level should have changed",
  async function (this: KoluWorld) {
    const before = (this as any).__zoomBefore as number | undefined;
    await this.page.waitForFunction(
      ({ sel, prev }: { sel: string; prev: number }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const zoom = parseFloat(el.getAttribute("data-zoom") ?? "1");
        return Math.abs(zoom - prev) > 0.01;
      },
      { sel: CANVAS_SELECTOR, prev: before ?? 1 },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I press the fit-all shortcut", async function (this: KoluWorld) {
  // Mod+Shift+1 = fit all tiles in viewport
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await this.page.keyboard.down(modifier);
  await this.page.keyboard.down("Shift");
  await this.page.keyboard.press("Digit1");
  await this.page.keyboard.up("Shift");
  await this.page.keyboard.up(modifier);
  await this.waitForFrame();
});

// "the close confirmation should be visible" is defined in worktree_steps.ts
