import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";
import * as os from "node:os";

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    // Use paths guaranteed to exist on all platforms (no mkdir needed)
    const dirs = [os.homedir(), os.tmpdir(), "/"].slice(0, count);
    const resp = await this.page.request.fetch("/rpc/session/test__set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        json: {
          terminals: dirs.map((cwd, i) => ({ id: String(i), cwd })),
          savedAt: Date.now(),
        },
      }),
    });
    assert.ok(resp.ok(), `session/test__set failed: ${resp.status()}`);
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    // Under 8 parallel workers, page/server init can be slow.
    // Use waitForFunction for a reactive DOM check.
    await this.page.waitForFunction(
      () => {
        const card = document.querySelector('[data-testid="session-restore"]');
        return card && card.getBoundingClientRect().height > 0;
      },
      { timeout: 20000 },
    );
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
  // Wait for at least one terminal to appear — under load from 8 parallel
  // workers, server can be slow to spawn terminals. Use waitForFunction
  // for a reactive DOM check instead of locator.waitFor.
  await this.page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length > 0,
    SIDEBAR_ENTRY_SELECTOR,
    { timeout: 20000 },
  );
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
