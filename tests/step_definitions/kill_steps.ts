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
    await this.waitForFrame();
    // Close via command palette (close button was removed from sidebar)
    const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.press(`${MOD_KEY}+k`);
    const palette = this.page.locator('[data-testid="command-palette"]');
    await palette.locator("input").waitFor({ state: "visible", timeout: 3000 });
    await palette.locator("input").fill("Close terminal");
    await palette.locator("li", { hasText: "Close terminal" }).waitFor({ state: "visible", timeout: 3000 });
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
    const palette = this.page.locator('[data-testid="command-palette"]');
    await palette.locator("input").waitFor({ state: "visible", timeout: 3000 });
    await palette.locator("input").fill("Close terminal");
    await palette.locator("li", { hasText: "Close terminal" }).waitFor({ state: "visible", timeout: 3000 });
    await palette.locator("li", { hasText: "Close terminal" }).click();
    await this.waitForFrame();
  },
);

Then(
  "the sidebar should have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    // Use Playwright's built-in polling via expect-like pattern
    if (expected === 0) {
      await entries.first().waitFor({ state: "hidden", timeout: 10000 });
    } else {
      await entries.nth(expected - 1).waitFor({ state: "visible", timeout: 10000 });
      // Verify no extra entries
      for (let attempt = 0; attempt < 10; attempt++) {
        const count = await entries.count();
        if (count === expected) return;
        await this.waitForFrame();
      }
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
    // Natural exit can take a moment — use waitForFunction for reactive check
    const sel = SIDEBAR_ENTRY_SELECTOR;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: 20000 },
    );
  },
);
