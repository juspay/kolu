import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

// ── Actions ──

When("I click the Review tab", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-review"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await this.waitForFrame();
});

When(
  "I click the refresh button in the Review tab",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="review-refresh"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

When(
  "I click the changed file {string} in the Review tab",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `[data-testid="review-file-item"][data-path="${path}"]`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

// ── Assertions ──

Then("the Review tab should be active", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="review-tab"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the Review tab should indicate no git repository",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="review-no-repo"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Review tab should show the empty-changes message",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="review-empty"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Review tab should list a changed file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `[data-testid="review-file-item"][data-path="${path}"]`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Review tab should render a diff view",
  async function (this: KoluWorld) {
    // @git-diff-view/solid marks its root container with data-component="git-diff-view".
    const diff = this.page.locator(
      '[data-testid="review-diff"] [data-component="git-diff-view"]',
    );
    await diff.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
