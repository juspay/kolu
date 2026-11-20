import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import {
  type KoluWorld,
  POLL_TIMEOUT,
  DOCK_ROW_SELECTOR,
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
    await this.page
      .locator(`${DOCK_ROW_SELECTOR}[data-terminal-id="${id}"]`)
      .click();
    await this.page
      .locator(`[data-terminal-id="${id}"][data-focused]`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    await this.waitForFrame();
  },
);

When(
  "I click dock row {int}",
  async function (this: KoluWorld, position: number) {
    const row = this.page.locator(DOCK_ROW_SELECTOR).nth(position - 1);
    await row.click();
    const id = await row.getAttribute("data-terminal-id");
    assert.ok(id, `Dock row ${position} has no terminal ID`);
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
      .locator(DOCK_ROW_SELECTOR)
      .count();
  },
);

Then(
  "the workspace switcher should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedWorkspaceSwitcherCount ?? 0) + delta;
    const buttons = this.page.locator(DOCK_ROW_SELECTOR);
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
