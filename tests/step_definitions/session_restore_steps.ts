import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";
import * as fs from "node:fs";

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    // Create unique temp dirs that survive macOS /tmp cleanup
    const dirs: string[] = [];
    for (let i = 0; i < count; i++) {
      const dir = `/tmp/kolu-session-test-${Date.now()}-${i}`;
      fs.mkdirSync(dir, { recursive: true });
      dirs.push(dir);
    }
    // Seed the session directly on the server — no auto-save timing dependency
    await this.page.request.fetch("/rpc/session/test__set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        json: {
          terminals: dirs.map((cwd, i) => ({ id: String(i), cwd })),
          savedAt: Date.now(),
        },
      }),
    });
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    const card = this.page.locator('[data-testid="session-restore"]');
    await card.waitFor({ state: "visible", timeout: 10000 });
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
  // Wait for at least one terminal to appear
  const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
  await entries.first().waitFor({ state: "visible", timeout: 15000 });
});

Then(
  "there should be {int} sidebar entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: SIDEBAR_ENTRY_SELECTOR, count: expected },
      { timeout: 15000 },
    );
    const actual = await entries.count();
    assert.strictEqual(
      actual,
      expected,
      `Expected ${expected} sidebar entries, got ${actual}`,
    );
  },
);
