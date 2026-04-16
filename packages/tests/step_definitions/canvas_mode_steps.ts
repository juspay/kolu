import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TOGGLE_SELECTOR = '[data-testid="canvas-mode-toggle"]';
const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const MINIMAP_SELECTOR = '[data-testid="canvas-minimap"]';
const MINIMAP_MAP_SELECTOR = '[data-testid="minimap-map"]';
const MINIMAP_TOGGLE_SELECTOR = '[data-testid="minimap-toggle"]';
const MINIMAP_VIEWPORT_RECT_SELECTOR = '[data-testid="minimap-viewport-rect"]';

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

Then(
  "the newest canvas tile should be centered in the viewport",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const container = document.querySelector(sel);
        if (!container) return false;
        const tiles = container.querySelectorAll(
          "[data-terminal-id][data-visible]",
        );
        if (tiles.length < 2) return false;
        const tile = tiles[tiles.length - 1] as HTMLElement;
        const cRect = container.getBoundingClientRect();
        const tRect = tile.getBoundingClientRect();
        // Tile center vs container center — allow tolerance for grid snapping
        const tileCx = tRect.left + tRect.width / 2 - cRect.left;
        const tileCy = tRect.top + tRect.height / 2 - cRect.top;
        const viewCx = cRect.width / 2;
        const viewCy = cRect.height / 2;
        const tolerance = 40; // grid snap (24px) + rounding
        return (
          Math.abs(tileCx - viewCx) < tolerance &&
          Math.abs(tileCy - viewCy) < tolerance
        );
      },
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I create a terminal with keyboard shortcut",
  async function (this: KoluWorld) {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.down(modifier);
    await this.page.keyboard.press("t");
    await this.page.keyboard.up(modifier);
    await this.waitForFrame();
  },
);

// ── Minimap steps ──

Then("the minimap should be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => document.querySelector(sel) !== null,
    MINIMAP_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "the minimap toggle button should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) !== null,
      MINIMAP_TOGGLE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the minimap map should be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => document.querySelector(sel) !== null,
    MINIMAP_MAP_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "the minimap map should not be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) === null,
      MINIMAP_MAP_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I click the minimap toggle", async function (this: KoluWorld) {
  const toggle = this.page.locator(MINIMAP_TOGGLE_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

When(
  "I save the canvas viewport state",
  async function (this: KoluWorld) {
    const state = await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return {
        zoom: el.getAttribute("data-zoom"),
        transform: (el.firstElementChild as HTMLElement)?.style.transform,
      };
    }, CANVAS_SELECTOR);
    (this as any).__savedViewportState = state;
  },
);

When(
  "I drag the minimap viewport rect",
  async function (this: KoluWorld) {
    const rect = this.page.locator(MINIMAP_VIEWPORT_RECT_SELECTOR);
    await rect.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const box = await rect.boundingBox();
    if (!box) throw new Error("Viewport rect not visible");
    // Drag from center of viewport rect 30px to the right
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await this.page.mouse.move(cx, cy);
    await this.page.mouse.down();
    await this.page.mouse.move(cx + 30, cy, { steps: 5 });
    await this.page.mouse.up();
    await this.waitForFrame();
  },
);

Then(
  "the canvas viewport state should have changed",
  async function (this: KoluWorld) {
    const saved = (this as any).__savedViewportState as {
      zoom: string | null;
      transform: string | null;
    } | null;
    await this.page.waitForFunction(
      ({ sel, prev }: { sel: string; prev: { transform: string | null } }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const transform = (el.firstElementChild as HTMLElement)?.style.transform;
        return transform !== prev.transform;
      },
      { sel: CANVAS_SELECTOR, prev: { transform: saved?.transform ?? null } },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// "the close confirmation should be visible" is defined in worktree_steps.ts
