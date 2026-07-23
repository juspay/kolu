/** Terminal switcher — step definitions.
 *
 *  Phrasing keeps historical "workspace switcher" step names so feature
 *  files across the suite need not rename every line. Resolutions:
 *
 *  - "branch pill" / "branch" → dock row (`dock-row`)
 *  - "switcher toggle" → dock's search-icon (`dock-search`)
 *  - "hover the switcher" → click dock search (opens scoped palette)
 *  - "panel" → command palette open (often Terminals › local from dock search)
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

const HOST_HEADER_SELECTOR = `${PALETTE_SELECTOR} [data-testid="palette-host-header"]`;

Then(
  "the palette host header {string} should be visible",
  async function (this: KoluWorld, hostName: string) {
    const header = this.page.locator(HOST_HEADER_SELECTOR, {
      hasText: hostName,
    });
    await header.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the palette host header {string} should show at least {int} terminal(s)",
  async function (this: KoluWorld, hostName: string, min: number) {
    const header = this.page
      .locator(HOST_HEADER_SELECTOR)
      .filter({ hasText: hostName })
      .first();
    await header.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const countAttr = await header.getAttribute("data-count");
    const count = Number(countAttr ?? "0");
    assert.ok(
      count >= min,
      `Expected host header "${hostName}" count ≥ ${min}, got ${countAttr}`,
    );
  },
);

Then(
  "the palette breadcrumb should not show a host segment after Terminals",
  async function (this: KoluWorld) {
    const nav = this.page.locator(`${PALETTE_SELECTOR} nav`);
    await nav.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = (await nav.textContent()) ?? "";
    // Auto-expanded Terminals browse: breadcrumb is Commands › Terminals only
    // (no › local / › zest). Collapse whitespace from button separators.
    const normalized = text.replace(/\s+/g, " ").trim();
    assert.ok(
      /Terminals\s*$/.test(normalized),
      `Expected breadcrumb to end at Terminals (no host segment), got "${text}"`,
    );
    // Stronger: buttons after Commands should be only "Terminals".
    const labels = await nav.locator("button").allTextContents();
    const afterCommands = labels.map((l) => l.trim()).filter(Boolean);
    // ["Commands", "Terminals"] or just path segments without Commands label
    // depending on markup — accept any list whose last is Terminals and length ≤ 2
    // for the path chips (Commands + Terminals).
    assert.ok(
      afterCommands.includes("Terminals"),
      `Expected Terminals in breadcrumb buttons, got ${JSON.stringify(afterCommands)}`,
    );
    assert.ok(
      afterCommands.length <= 2,
      `Expected no host segment (≤2 breadcrumb buttons), got ${JSON.stringify(afterCommands)}`,
    );
  },
);
