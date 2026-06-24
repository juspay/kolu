/** Workspace switcher — step definitions.
 *
 *  The workspace-search surface unified with the command palette in
 *  #912: `Mod+Shift+K` and the dock's search-icon button both open
 *  the palette pre-drilled into the "Search workspaces" group, whose
 *  body renders the same facet sidebar + agent-state column grid the
 *  standalone mega level used to host.
 *
 *  These steps keep the original phrasing (so cross-cutting feature
 *  files don't need re-writing everywhere) but resolve to:
 *
 *  - "branch pill" / "branch" → dock row (`dock-row`)
 *  - "switcher toggle" → dock's search-icon button (`dock-search`)
 *  - "hover the switcher" → click the dock's search-icon (no
 *    hover-to-open surface; the click reaches the same palette state
 *    the keyboard shortcut would)
 *  - "panel" / "card" / "column" / "repo" / "idle-sub" →
 *    `workspace-switcher-*` testids inside the WorkspaceGrid body,
 *    which is mounted inside the command-palette dialog when the
 *    "Search workspaces" group is drilled into.
 *  - "switcher search" → the command palette's input
 *  - "close button" → Press Escape (Raycast-style palette has no
 *    dedicated close affordance) */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const DOCK_ROW_SELECTOR = '[data-testid="dock-row"]';
const DOCK_SEARCH_SELECTOR = '[data-testid="dock-search"]';
const PALETTE_SELECTOR = '[data-testid="command-palette"]';
const PALETTE_INPUT_SELECTOR = `${PALETTE_SELECTOR} input`;
const PANEL_SELECTOR = '[data-testid="workspace-switcher-panel"]';
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

// "Hover the switcher" — the dock has no hover-to-open. The dock's
// search-icon click reaches the same palette state Mod+Shift+K would.
When("I hover the workspace switcher", async function (this: KoluWorld) {
  const toggle = this.page.locator(DOCK_SEARCH_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.page
    .locator(PANEL_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I move from the workspace switcher pill into the panel",
  async function (this: KoluWorld) {
    // Pill → panel hand-off doesn't apply (no hover bridge). Open
    // the palette directly via the dock's search icon; the panel
    // assertions still hold.
    const toggle = this.page.locator(DOCK_SEARCH_SELECTOR);
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
  const toggle = this.page.locator(DOCK_SEARCH_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

// Raycast-style palette closes on Escape rather than a dedicated
// close button. Phrasing stays for cross-feature compatibility.
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
    // The palette overlay covers the viewport; clicking on the
    // backdrop (well outside the dialog body) dismisses the palette.
    await this.page.mouse.click(5, 5);
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
  "the workspace switcher {string} column title should show a {string} state pip",
  async function (this: KoluWorld, bucket: string, expectedVariant: string) {
    // The shared StatePip is reused verbatim in the column header, so it
    // carries the same data-testid ("state-pip") and data-pip variant
    // — scoped here to the column matching `bucket` to disambiguate from
    // the pips on other columns and elsewhere on the surface.
    await this.page.waitForFunction(
      ({ bucketKey, variant }) => {
        const el = document.querySelector(
          `[data-testid="workspace-switcher-column"][data-agent-bucket="${bucketKey}"] [data-testid="state-pip"]`,
        );
        return el?.getAttribute("data-pip") === variant;
      },
      { bucketKey: bucket, variant: expectedVariant },
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

Then(
  "workspace switcher card {int} should be highlighted",
  async function (this: KoluWorld, position: number) {
    const card = this.page.locator(CARD_SELECTOR).nth(position - 1);
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      ({ selector, idx }) =>
        document
          .querySelectorAll(selector)
          [idx]?.getAttribute("data-highlighted") === "",
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
        Array.from(document.querySelectorAll(selector)).filter(
          (el) => el.getAttribute("data-highlighted") === "",
        ).length === 1,
      CARD_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);
