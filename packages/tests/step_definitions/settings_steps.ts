import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When("I click the settings button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="settings-trigger"]');
  await this.waitForFrame();
});

Then(
  "the settings popover should be visible",
  async function (this: KoluWorld) {
    const popover = this.page.locator('[data-testid="settings-popover"]');
    await popover.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the settings popover should not be visible",
  async function (this: KoluWorld) {
    const popover = this.page.locator('[data-testid="settings-popover"]');
    await popover.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the {string} new terminal theme button",
  async function (this: KoluWorld, mode: string) {
    await this.page.click(`[data-testid="new-terminal-theme-${mode}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the {string} new terminal theme button should be selected",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(`[data-testid="new-terminal-theme-${mode}"]`);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const pressed = await btn.getAttribute("aria-pressed");
    assert.strictEqual(
      pressed,
      "true",
      `Expected new-terminal-theme "${mode}" to be selected (aria-pressed=true)`,
    );
  },
);

When(
  "I click the {string} color scheme button",
  async function (this: KoluWorld, scheme: string) {
    await this.page.click(`[data-testid="color-scheme-${scheme}"]`);
    await this.waitForFrame();
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
    await active.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
