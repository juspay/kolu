import { When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  PILL_TREE_ENTRY_SELECTOR,
  MOD_KEY,
  POLL_TIMEOUT,
} from "../support/world.ts";
import * as assert from "node:assert";

/** Synthesize a click directly on the close-button DOM node. Real-mouse
 *  clicks on a stacked canvas tile lose to the active tile (z-10) on top —
 *  even with `force: true`, the dispatched mousedown bubbles up the parent
 *  chain and re-selects the tile instead of firing the close button's
 *  onClick. Calling `.click()` on the node skips the hit-test entirely. */
async function clickTileCloseButton(world: KoluWorld, id: string) {
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
    await clickTileCloseButton(this, id);
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
    await clickTileCloseButton(this, id);
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
  "the pill tree should have {int} terminal entry/entries",
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
  "the pill tree should eventually have {int} terminal entry/entries",
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
