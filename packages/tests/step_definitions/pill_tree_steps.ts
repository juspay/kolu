import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const PILL_TREE_SELECTOR = '[data-testid="pill-tree"]';
const BRANCH_SELECTOR = '[data-testid="pill-tree-branch"]';

Then("the pill tree should be visible", async function (this: KoluWorld) {
  const tree = this.page.locator(PILL_TREE_SELECTOR);
  await tree.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the pill tree should not be visible", async function (this: KoluWorld) {
  const tree = this.page.locator(PILL_TREE_SELECTOR);
  // Either the tree element is absent or it isn't laid out — both count
  // as "not visible" for the mobile path which doesn't mount it.
  const count = await tree.count();
  if (count === 0) return;
  const visible = await tree.first().isVisible();
  assert.ok(!visible, "Expected pill tree to not be visible");
});

Then(
  "the pill tree should have {int} branch pills",
  async function (this: KoluWorld, expected: number) {
    const branches = this.page.locator(BRANCH_SELECTOR);
    await branches.nth(expected - 1).waitFor({
      state: "visible",
      timeout: POLL_TIMEOUT,
    });
    const count = await branches.count();
    assert.strictEqual(count, expected, `Expected ${expected} branch pills`);
  },
);

Then(
  "the {word} pill tree branch should be the active pill",
  async function (this: KoluWorld, ordinal: string) {
    // 1-based: "first", "second", "third" → 1, 2, 3
    const indexMap: Record<string, number> = {
      first: 0,
      second: 1,
      third: 2,
      fourth: 3,
    };
    const idx = indexMap[ordinal];
    if (idx === undefined) throw new Error(`Unknown ordinal: ${ordinal}`);
    const branch = this.page.locator(BRANCH_SELECTOR).nth(idx);
    await branch.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const active = await branch.getAttribute("data-active");
    assert.strictEqual(
      active,
      "",
      `Expected branch ${idx + 1} to be the active pill`,
    );
  },
);

When(
  "I click pill tree branch {int}",
  async function (this: KoluWorld, position: number) {
    const branch = this.page.locator(BRANCH_SELECTOR).nth(position - 1);
    await branch.click();
    await this.waitForFrame();
  },
);
