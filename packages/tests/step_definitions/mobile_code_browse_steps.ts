/** Steps unique to the mobile right-panel drawer. The drawer mounts
 *  the same `RightPanel` as desktop, so file-tree, mode-picker, and
 *  file-view assertions live in `code_tab_steps.ts`; visibility of
 *  the panel itself lives in `right_panel_steps.ts`. Only the two
 *  mobile-specific actions are defined here. */

import { When } from "@cucumber/cucumber";
import { tapBackdropAtSafePoint } from "../support/drawer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CHROME_SHEET = '[data-testid="mobile-chrome-sheet"]';
const INSPECTOR_TOGGLE = `${CHROME_SHEET} [data-testid="inspector-toggle"]`;
const DRAWER_BACKDROP = '[data-testid="right-panel-drawer-backdrop"]';

When("I tap the mobile inspector toggle", async function (this: KoluWorld) {
  const btn = this.page.locator(INSPECTOR_TOGGLE);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.tap();
  await this.waitForFrame();
});

When("I tap the right panel drawer backdrop", async function (this: KoluWorld) {
  await tapBackdropAtSafePoint(this, DRAWER_BACKDROP, "bottom");
});
