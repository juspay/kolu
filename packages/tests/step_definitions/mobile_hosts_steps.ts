import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const HOST_ROW = '[data-testid="mobile-host-row"]';
const HOST_CHIP = `${HOST_ROW} [data-testid="mobile-host-chip"]`;
const ADD_OPEN = '[data-testid="mobile-host-add-open"]';
const ADD_SECTION = '[data-testid="mobile-host-add-section"]';

Then("the mobile host row should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(HOST_ROW)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the local host chip should be visible and active",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${HOST_CHIP}[data-host="local"][data-active]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I tap the local host chip", async function (this: KoluWorld) {
  await this.page.locator(`${HOST_CHIP}[data-host="local"]`).tap();
});

When("I tap the mobile add-host affordance", async function (this: KoluWorld) {
  await this.page.locator(ADD_OPEN).tap();
});

Then(
  "the mobile add-host section should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(ADD_SECTION)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
