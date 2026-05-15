/** Workspace switcher — step definitions.
 *
 *  The "workspace switcher" surface unified with the command palette
 *  in #912: `Mod+Shift+K` (and the dock's search-icon button) opens
 *  the palette pre-drilled into the "Search workspaces" group. These
 *  steps keep the original phrasing (so cross-cutting feature files
 *  don't need re-writing everywhere) but resolve to:
 *
 *  - "branch pill" / "branch" → dock row (`dock-row`)
 *  - "switcher toggle" → dock's search-icon button (`dock-search`)
 *  - "hover the switcher" → click the dock's search-icon (the dock
 *    has no hover-to-open surface; the click reaches the same palette
 *    state the keyboard shortcut would)
 *  - "panel" / "search" / "card" → command palette (`command-palette`)
 *    with the breadcrumb showing the "Search workspaces" group */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const DOCK_ROW_SELECTOR = '[data-testid="dock-row"]';
const SEARCH_BUTTON_SELECTOR = '[data-testid="dock-search"]';
const PALETTE_SELECTOR = '[data-testid="command-palette"]';
const PALETTE_INPUT_SELECTOR = `${PALETTE_SELECTOR} input`;
const PALETTE_OPTION_SELECTOR = `${PALETTE_SELECTOR} [role="option"]`;
const PALETTE_BREADCRUMB_SELECTOR = `${PALETTE_SELECTOR} nav`;

async function expectPaletteOnWorkspaces(world: KoluWorld): Promise<void> {
  await world.page
    .locator(PALETTE_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await world.page.waitForFunction(
    (sel) => {
      const nav = document.querySelector(sel);
      return nav?.textContent?.includes("Search workspaces") ?? false;
    },
    PALETTE_BREADCRUMB_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
}

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

// "Hover the switcher" — the dock has no hover-to-open. The
// search-icon click reaches the same palette state Mod+Shift+K would.
When("I hover the workspace switcher", async function (this: KoluWorld) {
  const toggle = this.page.locator(SEARCH_BUTTON_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await expectPaletteOnWorkspaces(this);
});

When(
  "I move from the workspace switcher pill into the panel",
  async function (this: KoluWorld) {
    // No hover bridge — open the palette directly via the icon. Any
    // downstream click assertions still target the same option rows.
    const toggle = this.page.locator(SEARCH_BUTTON_SELECTOR);
    await toggle.click();
    await expectPaletteOnWorkspaces(this);
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
  const toggle = this.page.locator(SEARCH_BUTTON_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

// Raycast-style palette closes on Escape, not via a dedicated close
// button. Keep the phrasing — the binding now presses Escape.
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
    // The palette overlay covers the viewport; clicking on the backdrop
    // (well outside the dialog body) dismisses the palette.
    await this.page.mouse.click(5, 5);
    await this.waitForFrame();
  },
);

Then(
  "the workspace switcher panel should be visible",
  async function (this: KoluWorld) {
    await expectPaletteOnWorkspaces(this);
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

Then(
  "the workspace switcher should show {int} card(s)",
  async function (this: KoluWorld, expected: number) {
    const options = this.page.locator(PALETTE_OPTION_SELECTOR);
    if (expected > 0) {
      await options
        .nth(expected - 1)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    }
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: PALETTE_OPTION_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click workspace switcher card {int}",
  async function (this: KoluWorld, position: number) {
    const card = this.page.locator(PALETTE_OPTION_SELECTOR).nth(position - 1);
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await card.click();
    await this.waitForFrame();
  },
);
