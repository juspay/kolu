import { When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  PILL_TREE_ENTRY_SELECTOR,
  MOD_KEY,
  POLL_TIMEOUT,
} from "../support/world.ts";
import * as assert from "node:assert";

When(
  "I close terminal {int} via sidebar",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index}`);
    const entry = this.page.locator(
      `[data-testid="canvas-tile"][data-terminal-id="${id}"]`,
    );
    // Hover to reveal the close button, then click it
    await entry.hover();
    await entry.locator('[data-testid="sidebar-close"]').click();
    // Confirm in the dialog — every close goes through CloseConfirm.
    const confirm = this.page.locator('[data-testid="close-confirm"]');
    await confirm.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await confirm.locator('[data-testid="close-confirm-close-all"]').click();
    // Wait for removal from DOM
    await entry.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the sidebar close button for terminal {int}",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index}`);
    const entry = this.page.locator(
      `[data-testid="canvas-tile"][data-terminal-id="${id}"]`,
    );
    await entry.hover();
    await entry.locator('[data-testid="sidebar-close"]').click();
  },
);

When(
  "I close the active terminal via command palette",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${MOD_KEY}+k`);
    const palette = this.page.locator('[data-testid="command-palette"]');
    await palette
      .locator("input")
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await palette.locator("input").fill("Close terminal");
    await palette
      .locator("li", { hasText: "Close terminal" })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await palette.locator("li", { hasText: "Close terminal" }).click();
    // Confirm in the dialog — every close goes through CloseConfirm.
    const confirm = this.page.locator('[data-testid="close-confirm"]');
    await confirm.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await confirm.locator('[data-testid="close-confirm-close-all"]').click();
    await this.waitForFrame();
  },
);

Then(
  "the sidebar should have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    const sel = PILL_TREE_ENTRY_SELECTOR;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the empty state tip should be visible", async function (this: KoluWorld) {
  const tip = this.page.locator('[data-testid="empty-state"]');
  await tip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the sidebar should eventually have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    // Natural exit can take a moment — use waitForFunction for reactive check
    const sel = PILL_TREE_ENTRY_SELECTOR;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: 20000 },
    );
  },
);
