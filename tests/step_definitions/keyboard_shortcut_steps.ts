import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
const SHORTCUTS_HELP_SELECTOR = '[data-testid="shortcuts-help"]';

When("I press the shortcuts help shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+/`);
  await this.page.waitForTimeout(200);
});

When(
  "I press the switch to terminal {int} shortcut",
  async function (this: KoluWorld, n: number) {
    await this.page.keyboard.press(`${MOD_KEY}+${n}`);
    await this.page.waitForTimeout(200);
  },
);

When("I press the next terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+BracketRight`);
  await this.page.waitForTimeout(200);
});

When("I press the prev terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+BracketLeft`);
  await this.page.waitForTimeout(200);
});

When("I press the create terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+t`);
  await this.page.waitForTimeout(500);
});

When(
  "I press the create terminal in cwd shortcut",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${MOD_KEY}+Shift+t`);
    await this.page.waitForTimeout(500);
  },
);

When("I click outside the shortcuts help", async function (this: KoluWorld) {
  await this.page.mouse.click(10, 10);
  await this.page.waitForTimeout(200);
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
