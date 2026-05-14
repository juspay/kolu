/** Awaiting dock — step definitions. */

import { Then } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="awaiting-dock"]';
const CARD_SELECTOR = '[data-testid="awaiting-dock-card"]';
const WORKING_SELECTOR = '[data-testid="awaiting-dock-working"]';

Then("the awaiting dock should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
