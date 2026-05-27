/** Steps unique to the mobile right-panel drawer. The drawer mounts
 *  the same `RightPanel` as desktop, so file-tree, mode-picker,
 *  file-view, and chevron-close assertions live in
 *  `code_tab_steps.ts` / `right_panel_steps.ts`. Only the
 *  chrome-sheet trigger is mobile-specific. */

import { When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const INSPECTOR_TOGGLE =
  '[data-testid="mobile-chrome-sheet"] [data-testid="inspector-toggle"]';

When("I tap the mobile inspector toggle", async function (this: KoluWorld) {
  const btn = this.page.locator(INSPECTOR_TOGGLE);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.tap();
  await this.waitForFrame();
});
