import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

When("I create a terminal", async function (this: KoluWorld) {
  const id = await this.createTerminal();
  this.createdTerminalIds.push(id);
});

When(
  "I select terminal {int} in the sidebar",
  async function (this: KoluWorld, index: number) {
    // Select by the Nth terminal created in this scenario (1-based)
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    await this.page
      .locator(`[data-testid="sidebar"] [data-terminal-id="${id}"]`)
      .click();
    // Wait for the selected terminal to become active (data-visible attribute appears)
    await this.page
      .locator(`[data-terminal-id="${id}"][data-visible]`)
      .waitFor({ state: "attached", timeout: 5000 });
    // Brief settle for Terminal.tsx visibility effect to fire (auto-focus + remeasure)
    await this.page.waitForTimeout(300);
  },
);

Then(
  "the empty state tip should not be visible",
  async function (this: KoluWorld) {
    const tip = this.page.locator('[data-testid="empty-state"]');
    await tip.waitFor({ state: "hidden" });
  },
);

Given("I note the sidebar entry count", async function (this: KoluWorld) {
  this.savedSidebarCount = await this.page
    .locator(SIDEBAR_ENTRY_SELECTOR)
    .count();
});

Then(
  "the sidebar should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedSidebarCount ?? 0) + delta;
    // Wait for entries to appear (onMount restores terminals asynchronously after refresh)
    const buttons = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    await buttons
      .nth(expected - 1)
      .waitFor({ state: "visible", timeout: 5000 });
    const current = await buttons.count();
    const baseline = this.savedSidebarCount ?? 0;
    assert.strictEqual(
      current - baseline,
      delta,
      `Expected ${delta} new sidebar entries (baseline ${baseline}), got ${current - baseline} (total ${current})`,
    );
  },
);

Then(
  "the terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Ghostty uses a hidden textarea for keyboard input.
    // Verify focus is inside the active terminal container (data-visible), not the sidebar.
    const hasFocus = await this.page.evaluate(
      () => !!document.activeElement?.closest("[data-visible]"),
    );
    assert.ok(
      hasFocus,
      "Expected keyboard focus inside the active terminal, but focus is elsewhere",
    );
  },
);

Then(
  "the active terminal should show {string}",
  async function (this: KoluWorld, expected: string) {
    await pollUntilBufferContains(this.page, expected);
  },
);
