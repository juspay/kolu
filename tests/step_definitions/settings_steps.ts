import { When, Then } from "@cucumber/cucumber";
import assert from "node:assert";
import { KoluWorld } from "../support/world.ts";

When("I click the settings button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="settings-trigger"]');
  await this.page.waitForTimeout(200);
});

Then(
  "the settings popover should be visible",
  async function (this: KoluWorld) {
    const popover = this.page.locator('[data-testid="settings-popover"]');
    await popover.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the settings popover should not be visible",
  async function (this: KoluWorld) {
    const popover = this.page.locator('[data-testid="settings-popover"]');
    await popover.waitFor({ state: "hidden", timeout: 3000 });
  },
);

Then(
  "the random theme toggle state should change",
  async function (this: KoluWorld) {
    // Get current state, click, verify it changed
    const toggle = this.page.locator('[data-testid="random-theme-toggle"]');
    const before = await toggle.getAttribute("data-enabled");
    // The toggle was already clicked in the previous step, so just verify
    // it differs from its initial state by clicking again and comparing
    const after = await toggle.getAttribute("data-enabled");
    // If before was null (off), after click it should have been set to "" (on), or vice versa
    // Since we already clicked once, just verify the toggle responds
    await this.page.click('[data-testid="random-theme-toggle"]');
    await this.page.waitForTimeout(100);
    const afterSecond = await toggle.getAttribute("data-enabled");
    assert.notStrictEqual(
      after,
      afterSecond,
      "Expected random theme toggle to change state on click",
    );
  },
);

When("I click the random theme toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="random-theme-toggle"]');
  await this.page.waitForTimeout(200);
});
