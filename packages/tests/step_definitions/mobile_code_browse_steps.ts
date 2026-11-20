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
