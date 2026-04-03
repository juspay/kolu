import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";

When("I reload the page and wait for ready", async function (this: KoluWorld) {
  await this.page.reload();
  await this.waitForReady();
});

Then(
  "the scroll lock toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="scroll-lock-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await this.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="scroll-lock-toggle"]')
          ?.getAttribute("data-enabled") === null,
      { timeout: 5000 },
    );
  },
);

Then(
  "the activity alerts toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="activity-alerts-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    await this.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="activity-alerts-toggle"]')
          ?.getAttribute("data-enabled") === null,
      { timeout: 5000 },
    );
  },
);
