import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

const MC_SELECTOR = '[data-testid="mission-control"]';
const MC_CARD_SELECTOR = '[data-testid="mission-control-card"]';
const MC_EXPAND_SELECTOR = '[data-testid="mission-control-expand"]';
const MC_EMPTY_SELECTOR = '[data-testid="mission-control-empty"]';

When("I click the Mission Control icon", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="mission-control-trigger"]').click();
  await this.waitForFrame();
});

When(
  "I click the Mission Control expand toggle",
  async function (this: KoluWorld) {
    await this.page.locator(MC_EXPAND_SELECTOR).click();
    await this.waitForFrame();
  },
);

When(
  "I click terminal card {int}",
  async function (this: KoluWorld, index: number) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    await cards.nth(index - 1).click();
  },
);

Then("Mission Control should be visible", async function (this: KoluWorld) {
  const mc = this.page.locator(MC_SELECTOR);
  await mc.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("Mission Control should not be visible", async function (this: KoluWorld) {
  const mc = this.page.locator(MC_SELECTOR);
  await mc.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "Mission Control should show {int} terminal card(s)",
  async function (this: KoluWorld, expected: number) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    await this.page.waitForFunction(
      (count: number) =>
        document.querySelectorAll('[data-testid="mission-control-card"]')
          .length === count,
      expected,
      { timeout: POLL_TIMEOUT },
    );
    const actual = await cards.count();
    assert.strictEqual(actual, expected);
  },
);

Then(
  "Mission Control should show the empty state",
  async function (this: KoluWorld) {
    const empty = this.page.locator(MC_EMPTY_SELECTOR);
    await empty.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "Mission Control should have an active card",
  async function (this: KoluWorld) {
    const activeCard = this.page.locator(`${MC_CARD_SELECTOR}[data-active]`);
    await activeCard.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I press the Mission Control shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+.`);
  await this.waitForFrame();
});

When("I jump to the previous terminal", async function (this: KoluWorld) {
  await this.page.keyboard.press("Control+Tab");
  await this.waitForFrame();
});
