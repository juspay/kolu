/** Activity dock — step definitions. */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="activity-dock"]';
const TOGGLE_SELECTOR = '[data-testid="activity-dock-toggle"]';
const CARD_SELECTOR = '[data-testid="activity-dock-card"]';
const WORKING_SELECTOR = '[data-testid="activity-dock-working"]';

Then("the awaiting dock should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

// Dock defaults to collapsed; tests that want to assert against cards or
// working pills need to expand first. Any rail segment toggles, so click
// whichever appears first.
When("the awaiting dock is expanded", async function (this: KoluWorld) {
  await this.page
    .locator(TOGGLE_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const dock = this.page.locator(DOCK_SELECTOR);
  if ((await dock.getAttribute("data-collapsed")) !== null) {
    await this.page.locator(TOGGLE_SELECTOR).first().click();
  }
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-collapsed") === null,
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "the awaiting dock should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_SELECTOR)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the awaiting dock should show {int} card(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: CARD_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the awaiting dock should show {int} working pill(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: WORKING_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);
