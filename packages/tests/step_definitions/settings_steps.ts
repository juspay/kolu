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

When(
  "I click the {string} theme mode button",
  async function (this: KoluWorld, mode: string) {
    await this.page.click(`[data-testid="theme-mode-${mode}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the theme mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    // The selected option gets `bg-accent`; siblings get `bg-surface-2`.
    // We check by comparing the `class` attribute instead of a dedicated
    // data attribute because the segmented control mirrors the existing
    // `color-scheme-*` pattern in this same popover — keeping them
    // uniform is more valuable than adding a new `data-selected` just here.
    const button = this.page.locator(`[data-testid="theme-mode-${mode}"]`);
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const cls = await button.getAttribute("class");
    assert.match(
      cls ?? "",
      /bg-accent/,
      `Expected theme-mode-${mode} to be the selected option (bg-accent)`,
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
