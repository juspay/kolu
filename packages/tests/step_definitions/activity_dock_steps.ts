/** Activity dock — step definitions. */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="activity-dock"]';
const RAIL_SELECTOR = '[data-testid="activity-dock-rail"]';
const MODE_TOGGLE_SELECTOR = '[data-testid="activity-dock-mode-toggle"]';
const CARD_SELECTOR = '[data-testid="activity-dock-card"]';
const WORKING_SELECTOR = '[data-testid="activity-dock-working"]';

Then("the awaiting dock should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

// The dock defaults to "cards" mode now (#903 — primary navigator).
// "Expanded" semantically means cards mode, so this step ensures the
// dock is not in rail mode, clicking the header chevron to expand if
// needed. Mega mode counts as "expanded enough" for assertions that
// only check for the presence of cards/pills.
When("the awaiting dock is expanded", async function (this: KoluWorld) {
  const dock = this.page.locator(DOCK_SELECTOR);
  await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await dock.getAttribute("data-mode")) === "rail") {
    await this.page.locator(MODE_TOGGLE_SELECTOR).click();
  }
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-mode") !== "rail",
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

Then(
  "the awaiting dock should default to cards mode",
  async function (this: KoluWorld) {
    const dock = this.page.locator(DOCK_SELECTOR);
    await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const mode = await dock.getAttribute("data-mode");
    if (mode !== "cards") {
      throw new Error(`Expected dock mode "cards", got "${mode}"`);
    }
  },
);

Then(
  "the awaiting dock should be in {string} mode",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ selector, mode }) =>
        document.querySelector(selector)?.getAttribute("data-mode") === mode,
      { selector: DOCK_SELECTOR, mode: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I collapse the awaiting dock to rail", async function (this: KoluWorld) {
  await this.page.locator(MODE_TOGGLE_SELECTOR).click();
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-mode") === "rail",
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I click rail segment {int}",
  async function (this: KoluWorld, position: number) {
    const rail = this.page.locator(RAIL_SELECTOR).nth(position - 1);
    await rail.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await rail.click();
    await this.waitForFrame();
  },
);
