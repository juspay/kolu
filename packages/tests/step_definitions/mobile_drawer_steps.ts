import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const PULL_HANDLE = '[data-testid="mobile-pull-handle"]';
const SHEET = '[data-testid="mobile-chrome-sheet"]';
const BACKDROP = '[data-testid="mobile-chrome-backdrop"]';
const PILL_BRANCH = '[data-testid="mobile-pill-branch"]';
// MobileChromeSheet reuses the same `palette-trigger` testid as the desktop
// ChromeBar's palette button. Scope to the open sheet to disambiguate.
const PALETTE_BTN = `${SHEET} [data-testid="palette-trigger"]`;

When("I tap the mobile pull handle", async function (this: KoluWorld) {
  await this.page.locator(PULL_HANDLE).tap();
});

When("I tap the mobile chrome backdrop", async function (this: KoluWorld) {
  await this.page.locator(BACKDROP).tap();
});

When("I tap the inactive mobile pill branch", async function (this: KoluWorld) {
  // The drawer always shows every terminal; one carries `data-active`. The
  // other(s) are tap targets to switch. With the two-terminal background
  // (one auto + one explicit create) there is exactly one inactive pill.
  await this.page.locator(`${PILL_BRANCH}:not([data-active])`).first().tap();
});

When(
  "I tap the palette button in the drawer",
  async function (this: KoluWorld) {
    await this.page.locator(PALETTE_BTN).tap();
  },
);

Then(
  "the mobile chrome sheet should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(SHEET)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile chrome sheet should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(SHEET)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);
