import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
const WEB_VIEW_SELECTOR = '[data-testid="web-view"]';
const URL_INPUT_SELECTOR = '[data-testid="web-view-url"]';
const IFRAME_SELECTOR = '[data-testid="web-view-iframe"]';

When("I press the toggle web view shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+KeyB`);
  await this.page.waitForTimeout(300);
});

When("I click the web view close button", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="web-view-close"]').click();
  await this.page.waitForTimeout(300);
});

When(
  "I enter {string} in the web view URL bar",
  async function (this: KoluWorld, url: string) {
    const input = this.page.locator(URL_INPUT_SELECTOR);
    await input.waitFor({ state: "visible", timeout: 3000 });
    await input.fill(url);
    await input.press("Enter");
    await this.page.waitForTimeout(300);
  },
);

When("I click the web view refresh button", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="web-view-refresh"]').click();
  await this.page.waitForTimeout(300);
});

When(
  "I drag the resize handle {int} pixels to the {word}",
  async function (this: KoluWorld, pixels: number, direction: string) {
    const handle = this.page.locator('[data-testid="web-view-handle"]');
    await handle.waitFor({ state: "visible", timeout: 3000 });
    const box = await handle.boundingBox();
    assert.ok(box, "Resize handle has no bounding box");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    const deltaX = direction === "right" ? pixels : -pixels;
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(startX + deltaX, startY, { steps: 10 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(500);
  },
);

Then("the web view panel should be visible", async function (this: KoluWorld) {
  const panel = this.page.locator(WEB_VIEW_SELECTOR);
  await panel.waitFor({ state: "visible", timeout: 3000 });
});

Then(
  "the web view panel should not be visible",
  async function (this: KoluWorld) {
    const panel = this.page.locator(WEB_VIEW_SELECTOR);
    await panel.waitFor({ state: "hidden", timeout: 3000 });
  },
);

Then(
  "the web view iframe should have src {string}",
  async function (this: KoluWorld, expected: string) {
    const iframe = this.page.locator(IFRAME_SELECTOR);
    await iframe.waitFor({ state: "visible", timeout: 3000 });
    const src = await iframe.getAttribute("src");
    assert.ok(
      src?.includes(expected),
      `Expected iframe src to contain "${expected}", got "${src}"`,
    );
  },
);

Then(
  "the web view URL bar should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const input = this.page.locator(URL_INPUT_SELECTOR);
    await input.waitFor({ state: "visible", timeout: 3000 });
    const value = await input.inputValue();
    assert.ok(
      value.includes(expected),
      `Expected URL bar to contain "${expected}", got "${value}"`,
    );
  },
);

Then(
  "the web view empty state should be visible",
  async function (this: KoluWorld) {
    const empty = this.page.locator('[data-testid="web-view-empty"]');
    await empty.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the canvas should be narrower than before",
  async function (this: KoluWorld) {
    // Wait for reflow after web view opens
    await this.page.waitForTimeout(500);
    const current = await this.canvasBox();
    assert.ok(this.savedCanvas, "No saved canvas dimensions");
    assert.ok(
      current.width < this.savedCanvas.width,
      `Canvas width ${current.width} not narrower than ${this.savedCanvas.width}`,
    );
  },
);

Then(
  "the canvas should return to original width",
  async function (this: KoluWorld) {
    // Wait for reflow after web view closes
    await this.page.waitForTimeout(500);
    const current = await this.canvasBox();
    assert.ok(this.savedCanvas, "No saved canvas dimensions");
    // Allow 20% tolerance: Resizable.Panel vs plain div have slightly different sizing,
    // plus FitAddon quantizes to character grid boundaries
    const tolerance = this.savedCanvas.width * 0.2;
    assert.ok(
      Math.abs(current.width - this.savedCanvas.width) < tolerance,
      `Canvas width ${current.width} did not return to ~${this.savedCanvas.width} (tolerance ${tolerance.toFixed(0)})`,
    );
  },
);

Then(
  "the canvas should be wider than before",
  async function (this: KoluWorld) {
    await this.page.waitForTimeout(500);
    const current = await this.canvasBox();
    assert.ok(this.savedCanvas, "No saved canvas dimensions");
    assert.ok(
      current.width > this.savedCanvas.width,
      `Canvas width ${current.width} not wider than ${this.savedCanvas.width}`,
    );
  },
);
