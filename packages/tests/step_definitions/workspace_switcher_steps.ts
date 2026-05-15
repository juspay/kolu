/** Workspace switcher — step definitions.
 *
 *  The "workspace switcher" surface retired with #903; its mega-level
 *  search + repo facets + agent-state columns moved into the activity
 *  dock's mega mode. These steps keep the original phrasing (so cross-
 *  cutting feature files don't need to be rewritten everywhere) but
 *  resolve to the dock's surface:
 *
 *  - "branch pill" → dock row (`activity-dock-row`)
 *  - "hover the switcher" → switch the dock to mega mode (no hover-to-open)
 *  - "switcher toggle" → dock's mega-toggle button
 *  - "panel" → dock's mega body, which mounts `WorkspaceSearchPanel`
 *    verbatim, so `workspace-switcher-panel/search/card/repo/column`
 *    test-ids are preserved.
 *
 *  The dock's mega mode opens on Mod+Shift+K (the same shortcut the
 *  old chrome-bar switcher used) or on the dock-mega-toggle button. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="activity-dock"]';
const DOCK_ROW_SELECTOR = '[data-testid="activity-dock-row"]';
const MEGA_TOGGLE_SELECTOR = '[data-testid="activity-dock-mega-toggle"]';
const PANEL_SELECTOR = '[data-testid="workspace-switcher-panel"]';
const SEARCH_SELECTOR = '[data-testid="workspace-switcher-search"]';
const CARD_SELECTOR = '[data-testid="workspace-switcher-card"]';
const REPO_SELECTOR = '[data-testid="workspace-switcher-repo"]';
const COLUMN_SELECTOR = '[data-testid="workspace-switcher-column"]';
const IDLE_SUB_SELECTOR = '[data-testid="workspace-switcher-idle-sub"]';

Then(
  "the workspace switcher should be visible",
  async function (this: KoluWorld) {
    const dock = this.page.locator(DOCK_SELECTOR);
    await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher should not be visible",
  async function (this: KoluWorld) {
    const dock = this.page.locator(DOCK_SELECTOR);
    const count = await dock.count();
    if (count === 0) return;
    const visible = await dock.first().isVisible();
    assert.ok(!visible, "Expected activity dock to not be visible");
  },
);

Then(
  "the workspace switcher should have {int} branch pills",
  async function (this: KoluWorld, expected: number) {
    const rows = this.page.locator(DOCK_ROW_SELECTOR);
    await rows.nth(expected - 1).waitFor({
      state: "attached",
      timeout: POLL_TIMEOUT,
    });
    const count = await rows.count();
    assert.strictEqual(count, expected, `Expected ${expected} dock rows`);
  },
);

Then(
  "a workspace switcher pill should show {string}",
  async function (this: KoluWorld, expected: string) {
    const row = this.page
      .locator(DOCK_ROW_SELECTOR)
      .filter({ hasText: expected });
    await row.first().waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the {word} workspace switcher branch should be the active pill",
  async function (this: KoluWorld, ordinal: string) {
    const indexMap: Record<string, number> = {
      first: 0,
      second: 1,
      third: 2,
      fourth: 3,
    };
    const idx = indexMap[ordinal];
    if (idx === undefined) throw new Error(`Unknown ordinal: ${ordinal}`);
    const row = this.page.locator(DOCK_ROW_SELECTOR).nth(idx);
    await row.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    const active = await row.getAttribute("data-active");
    assert.strictEqual(
      active,
      "",
      `Expected dock row ${idx + 1} to be the active entry`,
    );
  },
);

When(
  "I click workspace switcher branch {int}",
  async function (this: KoluWorld, position: number) {
    const row = this.page.locator(DOCK_ROW_SELECTOR).nth(position - 1);
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await row.click();
    await this.waitForFrame();
  },
);

// "Hover the switcher" — the dock has no hover-to-open; switching to
// mega is the same surface the old hover affordance produced. The
// mega-toggle click bumps the dock into mega mode and renders the same
// `workspace-switcher-panel` content.
When("I hover the workspace switcher", async function (this: KoluWorld) {
  const toggle = this.page.locator(MEGA_TOGGLE_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.page
    .locator(PANEL_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I move from the workspace switcher pill into the panel",
  async function (this: KoluWorld) {
    // Pill → panel hand-off doesn't apply to the dock (no hover bridge).
    // Open mega directly; downstream click assertions still hold.
    const toggle = this.page.locator(MEGA_TOGGLE_SELECTOR);
    await toggle.click();
    await this.page
      .locator(PANEL_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I press the workspace switcher shortcut",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${MOD_KEY}+Shift+K`);
    await this.waitForFrame();
  },
);

When("I click the workspace switcher toggle", async function (this: KoluWorld) {
  const toggle = this.page.locator(MEGA_TOGGLE_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

When(
  "I click the workspace switcher close button",
  async function (this: KoluWorld) {
    const close = this.page.locator('[data-testid="workspace-switcher-close"]');
    await close.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await close.click();
    await this.waitForFrame();
  },
);

When(
  "I click outside the workspace switcher",
  async function (this: KoluWorld) {
    const canvas = this.page.locator('[data-testid="canvas-container"]');
    await canvas.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // Click well to the right of the dock's left-edge anchor so the
    // mousedown definitely lands outside the dock's bounding box.
    await canvas.click({ position: { x: 700, y: 400 } });
    await this.waitForFrame();
  },
);

Then(
  "the workspace switcher panel should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANEL_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher panel should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANEL_SELECTOR)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher search should be focused",
  async function (this: KoluWorld) {
    await this.page
      .locator(SEARCH_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      (selector) => document.activeElement === document.querySelector(selector),
      SEARCH_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
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

Then(
  "the workspace switcher should show buckets {string}",
  async function (this: KoluWorld, expected: string) {
    const wanted = expected.split(",").map((s) => s.trim());
    await this.page.waitForFunction(
      ({ selector, exp }) => {
        const got = Array.from(document.querySelectorAll(selector)).map((el) =>
          el.getAttribute("data-agent-bucket"),
        );
        return got.length === exp.length && got.every((v, i) => v === exp[i]);
      },
      { selector: COLUMN_SELECTOR, exp: wanted },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the workspace switcher idle column should show sub-buckets {string}",
  async function (this: KoluWorld, expected: string) {
    const wanted = expected.split(",").map((s) => s.trim());
    await this.page.waitForFunction(
      ({ selector, exp }) => {
        const got = Array.from(document.querySelectorAll(selector)).map((el) =>
          el.getAttribute("data-idle-sub"),
        );
        return got.length === exp.length && got.every((v, i) => v === exp[i]);
      },
      { selector: IDLE_SUB_SELECTOR, exp: wanted },
      { timeout: POLL_TIMEOUT },
    );
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
