import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

When("I click the activity alerts toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="activity-alerts-toggle"]');
  await this.waitForFrame();
});

When("I simulate an activity alert", async function (this: KoluWorld) {
  // Use page.evaluate to call the simulate function directly,
  // avoiding command palette navigation complexity.
  await this.page.evaluate(() => {
    (window as any).__koluSimulateAlert?.();
  });
  await this.waitForFrame();
});

Then("a sidebar entry should be notified", async function (this: KoluWorld) {
  const notified = this.page.locator('[data-testid="sidebar"] [data-alerting]');
  await notified.first().waitFor({ state: "visible", timeout: 3000 });
});

Then("no sidebar entry should be notified", async function (this: KoluWorld) {
  await this.waitForFrame();
  const count = await this.page
    .locator('[data-testid="sidebar"] [data-alerting]')
    .count();
  assert.strictEqual(count, 0, `Expected no notified entries, found ${count}`);
});

When("I click the notified sidebar entry", async function (this: KoluWorld) {
  const notified = this.page.locator('[data-testid="sidebar"] [data-alerting]');
  await notified.first().waitFor({ state: "visible", timeout: 3000 });
  await notified.first().click();
  await this.waitForFrame();
});
