/** Shared terminal lifecycle + buffer assertion steps. Lifted out of the
 *  old sidebar_steps.ts when #622 deleted the sidebar — these steps are
 *  surface-agnostic (work for canvas tiles, mobile pager, pill tree). The
 *  legacy "sidebar" wording is preserved on the count assertions because
 *  the pill tree is the user-facing terminal list now; the old phrasing
 *  still parses cleanly even though the surface name has changed. */

import { Given, When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  PILL_TREE_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

When("I create a terminal", async function (this: KoluWorld) {
  const id = await this.createTerminal();
  this.createdTerminalIds.push(id);
});

Then(
  "the active terminal should show {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForBufferContains(this.page, expected);
  },
);

Then("the terminal should have keyboard focus", async function (this: KoluWorld) {
  // Active terminal carries data-focused on its xterm wrapper. Poll because
  // Corvu's focus-trap release after dialogs is async (waitForFrame can be
  // insufficient on loaded CI).
  await this.page.waitForFunction(
    () => !!document.activeElement?.closest("[data-focused]"),
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I select terminal {int} in the sidebar",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    // Click the pill-tree branch for this terminal — replaces the old
    // sidebar card click target after #622.
    await this.page
      .locator(`${PILL_TREE_ENTRY_SELECTOR}[data-terminal-id="${id}"]`)
      .click();
    // Wait for the selected terminal to take focus.
    await this.page
      .locator(`[data-terminal-id="${id}"][data-focused]`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    await this.waitForFrame();
  },
);

Given("I note the sidebar entry count", async function (this: KoluWorld) {
  this.savedSidebarCount = await this.page
    .locator(PILL_TREE_ENTRY_SELECTOR)
    .count();
});

Then(
  "the sidebar should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedSidebarCount ?? 0) + delta;
    const buttons = this.page.locator(PILL_TREE_ENTRY_SELECTOR);
    await buttons
      .nth(expected - 1)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const current = await buttons.count();
    const baseline = this.savedSidebarCount ?? 0;
    assert.strictEqual(
      current - baseline,
      delta,
      `Expected ${delta} new pill entries (baseline ${baseline}), got ${current - baseline} (total ${current})`,
    );
  },
);

// "the sidebar should have N fewer terminal entries" already lives in
// worktree_steps.ts — don't redeclare it here.
