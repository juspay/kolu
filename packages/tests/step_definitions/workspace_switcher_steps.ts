import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const WORKSPACE_SWITCHER_SELECTOR = '[data-testid="workspace-switcher"]';
const BRANCH_SELECTOR = '[data-testid="workspace-switcher-pill"]';
const PANEL_SELECTOR = '[data-testid="workspace-switcher-panel"]';
const SEARCH_SELECTOR = '[data-testid="workspace-switcher-search"]';
const CARD_SELECTOR = '[data-testid="workspace-switcher-card"]';
const REPO_SELECTOR = '[data-testid="workspace-switcher-repo"]';

Then(
  "the workspace switcher should be visible",
  async function (this: KoluWorld) {
    const switcher = this.page.locator(WORKSPACE_SWITCHER_SELECTOR);
    await switcher.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher should not be visible",
  async function (this: KoluWorld) {
    const switcher = this.page.locator(WORKSPACE_SWITCHER_SELECTOR);
    // Either the switcher element is absent or it isn't laid out — both count
    // as "not visible" for the mobile path which doesn't mount it.
    const count = await switcher.count();
    if (count === 0) return;
    const visible = await switcher.first().isVisible();
    assert.ok(!visible, "Expected workspace switcher to not be visible");
  },
);

Then(
  "the workspace switcher should have {int} branch pills",
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
  "the {word} workspace switcher branch should be the active pill",
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
  "I click workspace switcher branch {int}",
  async function (this: KoluWorld, position: number) {
    const branch = this.page.locator(BRANCH_SELECTOR).nth(position - 1);
    await branch.click();
    await this.waitForFrame();
  },
);

When("I hover the workspace switcher", async function (this: KoluWorld) {
  const switcher = this.page.locator(WORKSPACE_SWITCHER_SELECTOR);
  await switcher.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await switcher.hover();
  await this.page
    .locator(PANEL_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the workspace switcher panel should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANEL_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I search the workspace switcher for {string}",
  async function (this: KoluWorld, query: string) {
    const search = this.page.locator(SEARCH_SELECTOR);
    await search.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await search.fill(query);
    await this.waitForFrame();
  },
);

When(
  "I click workspace switcher repo {string}",
  async function (this: KoluWorld, repoName: string) {
    const repo = this.page.locator(
      `${REPO_SELECTOR}[data-repo-name="${repoName}"]`,
    );
    await repo.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await repo.click();
    await this.waitForFrame();
  },
);

Then(
  "the workspace switcher should show {int} card(s)",
  async function (this: KoluWorld, expected: number) {
    const cards = this.page.locator(CARD_SELECTOR);
    if (expected > 0) {
      await cards
        .nth(expected - 1)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    }
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: CARD_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the workspace switcher should show only repo {string} cards",
  async function (this: KoluWorld, repoName: string) {
    const repos = await this.page
      .locator(CARD_SELECTOR)
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-repo-name")),
      );
    assert.deepStrictEqual(repos, [repoName]);
  },
);

When(
  "I click workspace switcher card {int}",
  async function (this: KoluWorld, position: number) {
    const card = this.page.locator(CARD_SELECTOR).nth(position - 1);
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await card.click();
    await this.waitForFrame();
  },
);
