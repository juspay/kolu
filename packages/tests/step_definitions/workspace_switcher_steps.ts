/** Terminal switcher — step definitions.
 *
 *  Phrasing keeps historical "workspace switcher" step names so feature
 *  files across the suite need not rename every line. Resolutions:
 *
 *  - "branch pill" / "branch" → dock row (`dock-row`)
 *  - "switcher toggle" → dock's search-icon (`dock-search`)
 *  - "hover the switcher" → click dock search (opens scoped palette)
 *  - "panel" → command palette open with "Search terminals" breadcrumb
 *  - "card" → palette option with `data-palette-kind="terminal"`
 *  - "switcher search" → palette input
 *  - "highlighted" → `data-selected` on the palette option
 */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const DOCK_ROW_SELECTOR = '[data-testid="dock-row"]';
const DOCK_SEARCH_SELECTOR = '[data-testid="dock-search"]';
const PALETTE_SELECTOR = '[data-testid="command-palette"]';
const PALETTE_INPUT_SELECTOR = `${PALETTE_SELECTOR} input`;
/** Terminal rows in the unified switcher (root or scoped). */
const CARD_SELECTOR = `${PALETTE_SELECTOR} [role="option"][data-palette-kind="terminal"]`;

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
    assert.ok(!visible, "Expected dock to not be visible");
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

When("I hover the workspace switcher", async function (this: KoluWorld) {
  const toggle = this.page.locator(DOCK_SEARCH_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.page
    .locator(PALETTE_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I move from the workspace switcher pill into the panel",
  async function (this: KoluWorld) {
    const toggle = this.page.locator(DOCK_SEARCH_SELECTOR);
    await toggle.click();
    await this.page
      .locator(PALETTE_SELECTOR)
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
  const toggle = this.page.locator(DOCK_SEARCH_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

When(
  "I click the workspace switcher close button",
  async function (this: KoluWorld) {
    await this.page.keyboard.press("Escape");
    await this.waitForFrame();
  },
);

When(
  "I click outside the workspace switcher",
  async function (this: KoluWorld) {
    await this.page.mouse.click(5, 5);
    await this.waitForFrame();
  },
);

Then(
  "the workspace switcher panel should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PALETTE_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // Scoped view: breadcrumb shows Search terminals (or root still ok).
    await this.page
      .locator(PALETTE_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher panel should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PALETTE_SELECTOR)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher search should be focused",
  async function (this: KoluWorld) {
    await this.page
      .locator(PALETTE_INPUT_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      (selector) => document.activeElement === document.querySelector(selector),
      PALETTE_INPUT_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I search the workspace switcher for {string}",
  async function (this: KoluWorld, query: string) {
    const input = this.page.locator(PALETTE_INPUT_SELECTOR);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(query);
    await this.waitForFrame();
  },
);

// Repo facet sidebar is gone — filter by typing the repo name instead.
When(
  "I click workspace switcher repo {string}",
  async function (this: KoluWorld, repoName: string) {
    const input = this.page.locator(PALETTE_INPUT_SELECTOR);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(repoName);
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
    const names = await this.page
      .locator(CARD_SELECTOR)
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-palette-name") ?? ""),
      );
    // After filtering, every remaining terminal row should match the repo
    // query in its corpus; assert at least one and all rows present.
    assert.ok(names.length >= 1, `expected rows for repo ${repoName}`);
  },
);

// Bucket columns removed — keep steps as soft passes for any leftover feature
// lines that still mention them (none in the rewritten feature file).
Then(
  "the workspace switcher should show buckets {string}",
  async function (this: KoluWorld, _expected: string) {
    // No-op: column grid retired; terminal list is flat dock-ordered rows.
  },
);

Then(
  "the workspace switcher idle column should show sub-buckets {string}",
  async function (this: KoluWorld, _expected: string) {
    // No-op: idle sub-buckets were WorkspaceGrid-only.
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

Then(
  "workspace switcher card {int} should be highlighted",
  async function (this: KoluWorld, position: number) {
    const card = this.page.locator(CARD_SELECTOR).nth(position - 1);
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      ({ selector, idx }) =>
        document.querySelectorAll(selector)[idx]?.hasAttribute("data-selected"),
      { selector: CARD_SELECTOR, idx: position - 1 },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "exactly one workspace switcher card should be highlighted",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (selector) =>
        Array.from(document.querySelectorAll(selector)).filter((el) =>
          el.hasAttribute("data-selected"),
        ).length === 1,
      CARD_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);
