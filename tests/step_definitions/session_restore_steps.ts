import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";

When("I create a second terminal", async function (this: KoluWorld) {
  await this.createTerminal();
});

When(
  "I kill all terminals and reload",
  async function (this: KoluWorld) {
    // Wait for the debounced session save to flush (500ms debounce + margin)
    await this.page.waitForTimeout(1000);
    // Kill all terminals on the server (session snapshot is already saved).
    // killAllTerminals() doesn't overwrite the saved session — saveSession ignores empty lists.
    await this.page.request.fetch("/rpc/terminal/killAll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({}),
    });
    // Reload to simulate fresh start
    await this.page.reload();
    await this.waitForSettled();
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    const card = this.page.locator('[data-testid="session-restore"]');
    await card.waitFor({ state: "visible", timeout: 5000 });
  },
);

Then(
  "the restore button should mention {string}",
  async function (this: KoluWorld, text: string) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.waitFor({ state: "visible", timeout: 5000 });
    const content = await btn.textContent();
    assert.ok(
      content?.includes(text),
      `Expected restore button to contain "${text}", got "${content}"`,
    );
  },
);

When("I click the restore button", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="restore-session"]');
  await btn.click();
  // Wait for terminals to be created and sidebar entries to appear
  const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
  await entries.first().waitFor({ state: "visible", timeout: 10000 });
});

Then(
  "there should be {int} sidebar entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    // Wait until the expected count is reached
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: SIDEBAR_ENTRY_SELECTOR, count: expected },
      { timeout: 10000 },
    );
    const actual = await entries.count();
    assert.strictEqual(
      actual,
      expected,
      `Expected ${expected} sidebar entries, got ${actual}`,
    );
  },
);
