import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
const PALETTE_SELECTOR = '[data-testid="command-palette"]';

When("I open the command palette", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+k`);
  await this.page.waitForTimeout(200);
});

When("I press {word}", async function (this: KoluWorld, key: string) {
  await this.page.keyboard.press(key);
  await this.page.waitForTimeout(200);
});

When("I click outside the command palette", async function (this: KoluWorld) {
  // Click the backdrop area (top-left corner, outside the centered palette)
  await this.page.mouse.click(10, 10);
  await this.page.waitForTimeout(200);
});

When(
  "I type {string} in the palette",
  async function (this: KoluWorld, text: string) {
    const input = this.page.locator(`${PALETTE_SELECTOR} input`);
    await input.waitFor({ state: "visible", timeout: 3000 });
    await input.fill(text);
    await this.page.waitForTimeout(200);
  },
);

Then("the command palette should be visible", async function (this: KoluWorld) {
  const palette = this.page.locator(PALETTE_SELECTOR);
  await palette.waitFor({ state: "visible", timeout: 3000 });
});

Then(
  "the command palette should not be visible",
  async function (this: KoluWorld) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    await palette.waitFor({ state: "hidden", timeout: 3000 });
  },
);

Then(
  "the command palette should show {int} result(s)",
  async function (this: KoluWorld, expected: number) {
    const items = this.page.locator(`${PALETTE_SELECTOR} [cmdk-item]`);
    const count = await items.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} palette results, got ${count}`,
    );
  },
);

Then(
  "palette item {int} should be selected",
  async function (this: KoluWorld, index: number) {
    // cmdk-solid sets data-selected="true" on the highlighted item
    const items = this.page.locator(`${PALETTE_SELECTOR} [cmdk-item]`);
    const item = items.nth(index - 1);
    await item.waitFor({ state: "visible", timeout: 3000 });
    const selected = await item.getAttribute("data-selected");
    assert.ok(
      selected === "true",
      `Palette item ${index} is not selected (data-selected: ${selected})`,
    );
  },
);

Then(
  "the last palette item should be selected",
  async function (this: KoluWorld) {
    const items = this.page.locator(`${PALETTE_SELECTOR} [cmdk-item]`);
    const count = await items.count();
    const last = items.nth(count - 1);
    const selected = await last.getAttribute("data-selected");
    assert.ok(
      selected === "true",
      `Last palette item is not selected (data-selected: ${selected})`,
    );
  },
);

Then(
  "no sendInput call should contain {string}",
  async function (this: KoluWorld, key: string) {
    const messages: string[] = await this.page.evaluate(
      () => (window as any).__wsSent ?? [],
    );
    for (const msg of messages) {
      if (!msg.includes("sendInput")) continue;
      assert.ok(
        !msg.includes(`"data":"${key}"`),
        `Keystroke "${key}" leaked via sendInput: ${msg}`,
      );
    }
  },
);
