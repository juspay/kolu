/** Steps for the mobile code-browser drawer — see
 *  `MobileCodeSheet.tsx`, `MobileTileView.tsx`, `MobileChromeSheet.tsx`. */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const FILES_TRIGGER = '[data-testid="mobile-files-trigger"]';
const CODE_SHEET = '[data-testid="mobile-code-sheet"]';
const CODE_BACK = '[data-testid="mobile-code-back"]';
const CODE_CLOSE = '[data-testid="mobile-code-close"]';
const TREE = '[data-testid="pierre-file-tree"]';
const FILE_VIEW = '[data-testid="pierre-file-view"]';
const PREVIEW_IFRAME = '[data-testid="browse-preview-iframe"]';

function fileRow(path: string): string {
  return `${TREE} [data-item-path="${path}"][data-item-type="file"]:not([data-file-tree-sticky-row])`;
}

When("I tap the mobile files button", async function (this: KoluWorld) {
  await this.page.locator(FILES_TRIGGER).tap();
});

When(
  "I tap mobile file {string}",
  async function (this: KoluWorld, path: string) {
    // Wait for the row to appear — `fsListAll` is a live stream that may
    // arrive shortly after the drawer opens. Pierre's virtualized tree
    // repositions rows reactively, so Playwright's stability check
    // never settles on a tap target inside the drawer; `dispatchEvent`
    // fires the click event the row's handler listens for without the
    // stability/visibility actionability gate.
    const row = this.page.locator(fileRow(path));
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await row.dispatchEvent("click");
    await this.waitForFrame();
  },
);

When("I tap the mobile code back button", async function (this: KoluWorld) {
  await this.page.locator(CODE_BACK).dispatchEvent("click");
  await this.waitForFrame();
});

When("I tap the mobile code close button", async function (this: KoluWorld) {
  await this.page.locator(CODE_CLOSE).dispatchEvent("click");
  await this.waitForFrame();
});

Then(
  "the mobile code sheet should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(CODE_SHEET)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile code sheet should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(CODE_SHEET)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile file tree should contain {string}",
  async function (this: KoluWorld, path: string) {
    await this.page
      .locator(fileRow(path))
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile file view should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(FILE_VIEW)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile file view should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(FILE_VIEW)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile html preview should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PREVIEW_IFRAME)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
