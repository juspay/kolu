import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";

When(
  "I close terminal {int} via sidebar",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index}`);
    // Select the terminal first by clicking its sidebar entry
    const entry = this.page.locator(
      `[data-testid="sidebar"] [data-terminal-id="${id}"]`,
    );
    await entry.click();
    await this.page.waitForTimeout(200);
    // Close via command palette (close button was removed from sidebar)
    const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.press(`${MOD_KEY}+k`);
    await this.page.waitForTimeout(200);
    const palette = this.page.locator('[data-testid="command-palette"]');
    await palette.locator("input").fill("Close terminal");
    await this.page.waitForTimeout(200);
    await palette.locator("li", { hasText: "Close terminal" }).click();
    // Wait for removal from DOM
    await entry.waitFor({ state: "detached", timeout: 5000 });
  },
);

When(
  "I close the active terminal via command palette",
  async function (this: KoluWorld) {
    const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.press(`${MOD_KEY}+k`);
    await this.page.waitForTimeout(200);
    const palette = this.page.locator('[data-testid="command-palette"]');
    await palette.locator("input").fill("Close terminal");
    await this.page.waitForTimeout(200);
    // Click the matching result
    await palette.locator("li", { hasText: "Close terminal" }).click();
    await this.page.waitForTimeout(500);
  },
);

Then(
  "the sidebar should have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    // Wait for the expected count (entries may still be animating out)
    for (let attempt = 0; attempt < 20; attempt++) {
      const count = await entries.count();
      if (count === expected) return;
      await this.page.waitForTimeout(300);
    }
    const count = await entries.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} sidebar entries, got ${count}`,
    );
  },
);

Then("the empty state tip should be visible", async function (this: KoluWorld) {
  const tip = this.page.locator('[data-testid="empty-state"]');
  await tip.waitFor({ state: "visible", timeout: 5000 });
});

Then(
  "the sidebar should eventually have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    // Natural exit can take a moment — poll with longer timeout
    for (let attempt = 0; attempt < 40; attempt++) {
      const count = await entries.count();
      if (count === expected) return;
      await this.page.waitForTimeout(500);
    }
    const count = await entries.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} sidebar entries eventually, got ${count}`,
    );
  },
);
