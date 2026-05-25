/** Steps unique to the mobile right-panel drawer. The drawer mounts
 *  the same `RightPanel` as desktop, so file-tree, mode-picker, and
 *  file-view assertions live in `code_tab_steps.ts`; visibility of
 *  the panel itself lives in `right_panel_steps.ts`. Only the two
 *  mobile-specific actions are defined here. */

import { When } from "@cucumber/cucumber";
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
  // The bottom drawer's overlay spans the full viewport. Tap near
  // the top edge where only the backdrop is visible — the default
  // center-of-element tap would land inside Drawer.Content (which
  // sits on top of the backdrop across the drawer's bounding box).
  const backdrop = this.page.locator(DRAWER_BACKDROP);
  await backdrop.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const box = await backdrop.boundingBox();
  if (!box) throw new Error("right panel drawer backdrop has no bounding box");
  await backdrop.tap({ position: { x: box.width / 2, y: 20 } });
  await this.waitForFrame();
});
