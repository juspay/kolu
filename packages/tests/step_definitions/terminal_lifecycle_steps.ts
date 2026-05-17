/** Shared terminal lifecycle + buffer assertion steps. Surface-agnostic —
 *  work for canvas tiles, mobile pager, and the workspace switcher. */

import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import {
  type KoluWorld,
  POLL_TIMEOUT,
  WORKSPACE_SWITCHER_ENTRY_SELECTOR,
} from "../support/world.ts";

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
  "I select terminal {int} in the workspace switcher",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    // Click the workspace-switcher branch for this terminal.
    await this.page
      .locator(`${WORKSPACE_SWITCHER_ENTRY_SELECTOR}[data-terminal-id="${id}"]`)
      .click();
    // Wait for the selected terminal to take focus.
    await this.page
      .locator(`[data-terminal-id="${id}"][data-focused]`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    await this.waitForFrame();
  },
);

/** Select a terminal by its position in the workspace switcher (1-based),
 *  regardless of `createdTerminalIds`. Complements
 *  `I select terminal {int} in the workspace switcher` (ID-based, waits on
 *  `data-focused`): this variant addresses entries by DOM position and
 *  waits on `data-visible`, which is what scenarios that don't track
 *  created IDs (or want to address pre-existing background terminals)
 *  need. */
When(
  "I select workspace switcher entry {int}",
  async function (this: KoluWorld, position: number) {
    const entry = this.page
      .locator(WORKSPACE_SWITCHER_ENTRY_SELECTOR)
      .nth(position - 1);
    await entry.click();
    const id = await entry.getAttribute("data-terminal-id");
    assert.ok(id, `Workspace switcher entry ${position} has no terminal ID`);
    await this.page
      .locator(`[data-terminal-id="${id}"][data-visible]`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    await this.waitForFrame();
  },
);

Given(
  "I note the workspace switcher entry count",
  async function (this: KoluWorld) {
    this.savedWorkspaceSwitcherCount = await this.page
      .locator(WORKSPACE_SWITCHER_ENTRY_SELECTOR)
      .count();
  },
);

Then(
  "the workspace switcher should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedWorkspaceSwitcherCount ?? 0) + delta;
    const buttons = this.page.locator(WORKSPACE_SWITCHER_ENTRY_SELECTOR);
    await buttons
      .nth(expected - 1)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const current = await buttons.count();
    const baseline = this.savedWorkspaceSwitcherCount ?? 0;
    assert.strictEqual(
      current - baseline,
      delta,
      `Expected ${delta} new pill entries (baseline ${baseline}), got ${current - baseline} (total ${current})`,
    );
  },
);

// "the workspace switcher should have N fewer terminal entries" already lives in
// worktree_steps.ts — don't redeclare it here.
