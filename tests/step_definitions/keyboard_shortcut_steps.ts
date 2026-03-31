import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY } from "../support/world.ts";
const SHORTCUTS_HELP_SELECTOR = '[data-testid="shortcuts-help"]';

When("I press the shortcuts help shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+/`);
  await this.waitForFrame();
});

When(
  "I press the switch to terminal {int} shortcut",
  async function (this: KoluWorld, n: number) {
    await this.page.keyboard.press(`${MOD_KEY}+${n}`);
  },
);

When("I press the next terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+BracketRight`);
});

When("I press the prev terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+BracketLeft`);
});

When(
  "I press the next terminal tab shortcut",
  async function (this: KoluWorld) {
    await this.page.keyboard.press("Control+Tab");
  },
);

When(
  "I press the prev terminal tab shortcut",
  async function (this: KoluWorld) {
    await this.page.keyboard.press("Control+Shift+Tab");
  },
);

When("I press the create terminal shortcut", async function (this: KoluWorld) {
  const countBefore = await this.page
    .locator('[data-testid="sidebar"] [data-terminal-id]')
    .count();
  await this.page.keyboard.press(`${MOD_KEY}+t`);
  // Wait for a new sidebar entry to appear
  await this.page
    .locator('[data-testid="sidebar"] [data-terminal-id]')
    .nth(countBefore)
    .waitFor({ state: "visible", timeout: 5000 });
});

When("I click outside the shortcuts help", async function (this: KoluWorld) {
  await this.page.mouse.click(10, 10);
});

Then("the shortcuts help should be visible", async function (this: KoluWorld) {
  const help = this.page.locator(SHORTCUTS_HELP_SELECTOR);
  await help.waitFor({ state: "visible", timeout: 3000 });
});

Then(
  "the shortcuts help should not be visible",
  async function (this: KoluWorld) {
    const help = this.page.locator(SHORTCUTS_HELP_SELECTOR);
    await help.waitFor({ state: "hidden", timeout: 3000 });
  },
);
