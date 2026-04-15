import { When, Then } from "@cucumber/cucumber";
import assert from "node:assert";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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

When("I click the shuffle theme toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="shuffle-theme-toggle"]');
  await this.waitForFrame();
});

Then(
  "the shuffle theme toggle state should change",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="shuffle-theme-toggle"]');
    const before = await toggle.getAttribute("data-enabled");
    await this.page.click('[data-testid="shuffle-theme-toggle"]');
    await this.waitForFrame();
    const after = await toggle.getAttribute("data-enabled");
    assert.notStrictEqual(
      before,
      after,
      "Expected shuffle theme toggle to change state on click",
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
