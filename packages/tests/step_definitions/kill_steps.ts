import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import {
  APP_KEY,
  type KoluWorld,
  POLL_TIMEOUT,
  DOCK_ROW_SELECTOR,
} from "../support/world.ts";

async function clickCloseButtonBypassingHitTest(world: KoluWorld, id: string) {
  await world.page.evaluate((targetId) => {
    const btn = document.querySelector(
      `[data-testid="canvas-tile"][data-terminal-id="${targetId}"] [data-testid="canvas-tile-close"]`,
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error(`close button not found for ${targetId}`);
    btn.click();
  }, id);
}

When(
  "I close terminal {int} via tile close button",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index}`);
    const entry = this.page.locator(
      `[data-testid="canvas-tile"][data-terminal-id="${id}"]`,
    );
    await clickCloseButtonBypassingHitTest(this, id);
    const confirm = this.page.locator('[data-testid="close-confirm"]');
    await confirm.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await confirm.locator('[data-testid="close-confirm-close-all"]').click();
    await entry.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the tile close button for terminal {int}",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index}`);
    await clickCloseButtonBypassingHitTest(this, id);
  },
);

When(
  "I close the active terminal via command palette",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${APP_KEY}+k`);
    const palette = this.page.locator('[data-testid="command-palette"]');
    await palette
      .locator("input")
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await palette.locator("input").fill("Close terminal");
    await palette
      .locator('[role="option"]', { hasText: "Close terminal" })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await palette
      .locator('[role="option"]', { hasText: "Close terminal" })
      .click();
    const confirm = this.page.locator('[data-testid="close-confirm"]');
    await confirm.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await confirm.locator('[data-testid="close-confirm-close-all"]').click();
    await this.waitForFrame();
  },
);

Then(
  "the workspace switcher should have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    const sel = DOCK_ROW_SELECTOR;
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
  "the workspace switcher should eventually have {int} terminal entry/entries",
  async function (this: KoluWorld, expected: number) {
    const sel = DOCK_ROW_SELECTOR;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: 20000 },
    );
  },
);
