/** Shared terminal lifecycle + buffer assertion steps. Surface-agnostic —
 *  work for canvas tiles, mobile pager, and the pill tree. */

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

Then(
  "the terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Active terminal carries data-focused on its xterm wrapper. Poll because
    // Corvu's focus-trap release after dialogs is async (waitForFrame can be
    // insufficient on loaded CI).
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-focused]"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I select terminal {int} in the pill tree",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    // Click the pill-tree branch for this terminal.
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

Given("I note the pill tree entry count", async function (this: KoluWorld) {
  this.savedPillTreeCount = await this.page
    .locator(PILL_TREE_ENTRY_SELECTOR)
    .count();
});

Then(
  "the pill tree should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedPillTreeCount ?? 0) + delta;
    const buttons = this.page.locator(PILL_TREE_ENTRY_SELECTOR);
    await buttons
      .nth(expected - 1)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const current = await buttons.count();
    const baseline = this.savedPillTreeCount ?? 0;
    assert.strictEqual(
      current - baseline,
      delta,
      `Expected ${delta} new pill entries (baseline ${baseline}), got ${current - baseline} (total ${current})`,
    );
  },
);

// "the pill tree should have N fewer terminal entries" already lives in
// worktree_steps.ts — don't redeclare it here.
