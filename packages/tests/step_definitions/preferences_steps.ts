import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When("I reload the page and wait for ready", async function (this: KoluWorld) {
  await this.page.reload();
  await this.waitForReady();
});

Then(
  "the scroll lock toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="scroll-lock-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="scroll-lock-toggle"]')
          ?.getAttribute("data-enabled") === null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the activity alerts toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="activity-alerts-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="activity-alerts-toggle"]')
          ?.getAttribute("data-enabled") === null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the {string} renderer button",
  async function (this: KoluWorld, value: string) {
    await this.page.click(`[data-testid="terminal-renderer-${value}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the terminal renderer should be {string}",
  async function (this: KoluWorld, renderer: string) {
    await this.page.waitForFunction(
      (expected) =>
        document
          .querySelector("[data-visible][data-terminal-id]")
          ?.getAttribute("data-renderer") === expected,
      renderer,
      { timeout: POLL_TIMEOUT },
    );
  },
);
