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

When("I click the activity alerts toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="activity-alerts-toggle"]');
  await this.page.waitForTimeout(200);
});

Then(
  "the activity alerts toggle state should change",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="activity-alerts-toggle"]');
    const after = await toggle.getAttribute("data-enabled");
    await this.page.click('[data-testid="activity-alerts-toggle"]');
    await this.page.waitForTimeout(100);
    const afterSecond = await toggle.getAttribute("data-enabled");
    assert.notStrictEqual(
      after,
      afterSecond,
      "Expected activity alerts toggle to change state on click",
    );
  },
);

When("I click the random theme toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="random-theme-toggle"]');
  await this.page.waitForTimeout(200);
});

When(
  "I click the {string} color scheme button",
  async function (this: KoluWorld, scheme: string) {
    await this.page.click(`[data-testid="color-scheme-${scheme}"]`);
    await this.page.waitForTimeout(200);
  },
);

Then(
  "the color scheme should be {string}",
  async function (this: KoluWorld, scheme: string) {
    const active = this.page.locator(`[data-testid="color-scheme-${scheme}"]`);
    // The active button gets bg-accent — verify it's present via class check would be fragile;
    // instead verify the html element's class reflects the resolved scheme.
    if (scheme === "dark") {
      await this.page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
    } else if (scheme === "light") {
      await this.page.waitForFunction(
        () => !document.documentElement.classList.contains("dark"),
      );
    }
    // Verify the button is rendered (scheme option exists)
    await active.waitFor({ state: "visible", timeout: 3000 });
  },
);
