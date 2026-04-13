import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

// ── Actions ──

When("I click the Files tab", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-files"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await this.waitForFrame();
});

When(
  "I expand the first directory in the file tree",
  async function (this: KoluWorld) {
    const branch = this.page.locator(
      '[data-testid="files-tab"] [role="treeitem"][data-branch]',
    );
    await branch.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await branch.first().click();
    // Wait for lazy-loaded children to appear.
    await this.page.waitForTimeout(1000);
  },
);

When("I click the file tree refresh button", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="files-refresh"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  // Wait for reload.
  await this.page.waitForTimeout(1000);
});

// ── Assertions ──

Then("the files tab should be visible", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="files-tab"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the file tree should have entries", async function (this: KoluWorld) {
  const items = this.page.locator(
    '[data-testid="files-tab"] [role="treeitem"]',
  );
  await items.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const count = await items.count();
  assert.ok(count > 0, `Expected file tree entries, got ${count}`);
});

Then(
  "directories should appear before files in the tree",
  async function (this: KoluWorld) {
    // Ark UI TreeView marks branches with data-branch attribute.
    const items = this.page.locator(
      '[data-testid="files-tab"] [role="treeitem"]',
    );
    await items.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });

    const count = await items.count();
    let seenFile = false;
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const isBranch = (await item.getAttribute("data-branch")) !== null;
      if (!isBranch) {
        seenFile = true;
      } else if (seenFile) {
        assert.fail(
          `Directory at index ${i} appears after a file — expected directories first`,
        );
      }
    }
  },
);

Then(
  "the expanded directory should have child entries",
  async function (this: KoluWorld) {
    // After expanding, there should be nested tree items inside a branch-content.
    const nested = this.page.locator(
      '[data-testid="files-tab"] [role="group"] [role="treeitem"]',
    );
    await nested.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const count = await nested.count();
    assert.ok(
      count > 0,
      `Expected child entries after expanding directory, got ${count}`,
    );
  },
);
