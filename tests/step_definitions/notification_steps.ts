import { When, Then } from "@cucumber/cucumber";
import * as assert from "node:assert";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";

When(
  "I click sidebar entry {int}",
  async function (this: KoluWorld, position: number) {
    await this.page.locator(SIDEBAR_ENTRY_SELECTOR).nth(position - 1).click();
    await this.page.waitForTimeout(300);
  },
);

When(
  "I run {string} in the background",
  async function (this: KoluWorld, command: string) {
    // Run a shell command that will produce output later (after user switches away)
    await this.terminalRun(command);
    // Don't wait for completion — return immediately so the user can switch terminals
    await this.page.waitForTimeout(200);
  },
);

/** Check if the Nth sidebar entry (1-based) has the data-notified attribute. */
async function isNotified(world: KoluWorld, position: number): Promise<boolean> {
  const entry = world.page.locator(SIDEBAR_ENTRY_SELECTOR).nth(position - 1);
  return (await entry.getAttribute("data-notified")) !== null;
}

Then(
  "sidebar entry {int} should be notified",
  async function (this: KoluWorld, position: number) {
    // Poll — session end event arrives after the 3s grace period
    const notified = await pollUntil(
      this.page,
      () => isNotified(this, position),
      (val) => val === true,
      { attempts: 30, intervalMs: 500 },
    );
    assert.ok(notified, `Expected sidebar entry ${position} to be notified`);
  },
);

Then(
  "sidebar entry {int} should not be notified",
  async function (this: KoluWorld, position: number) {
    const notified = await isNotified(this, position);
    assert.ok(
      !notified,
      `Expected sidebar entry ${position} to NOT be notified`,
    );
  },
);

Then(
  "sidebar entry {int} should not be notified within {int} seconds",
  async function (this: KoluWorld, position: number, seconds: number) {
    await this.page.waitForTimeout(seconds * 1000);
    const notified = await isNotified(this, position);
    assert.ok(
      !notified,
      `Expected sidebar entry ${position} to NOT be notified after ${seconds}s`,
    );
  },
);
