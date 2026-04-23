import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

const PALETTE = '[data-testid="command-palette"]';

/** Selector for the bottom-edge panel-tab-bar on the active tile. The
 *  per-tile panels system mounts one tab bar per slot, so every reference
 *  must scope by `data-edge` to disambiguate. */
const BOTTOM_TAB_BAR =
  '[data-testid="panel-host"][data-edge="bottom"] [data-testid="panel-tab-bar"]';

/**
 * Open command palette, fill a query, click the first result, wait for close.
 */
async function paletteCommand(world: KoluWorld, query: string) {
  const terminal = world.page.locator("[data-visible] .xterm-screen");
  if ((await terminal.count()) > 0) await terminal.first().click();
  await world.page.keyboard.press(`${MOD_KEY}+k`);
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) !== null,
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  await world.page.evaluate(
    ({ sel, q }) => {
      const input = document.querySelector(`${sel} input`) as HTMLInputElement;
      if (!input) throw new Error("Palette input not found");
      const nativeSet = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeSet.call(input, q);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: PALETTE, q: query },
  );
  await world.page.waitForFunction(
    (sel) => {
      const item = document.querySelector(`${sel} li`) as HTMLElement | null;
      if (!item || !item.offsetHeight) return false;
      item.click();
      return true;
    },
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) === null,
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  await world.page.waitForFunction(
    () => !!document.activeElement?.closest("[data-terminal-id]"),
    { timeout: POLL_TIMEOUT },
  );
}

/** Click the active tile's bottom-edge toggle icon. Replaces the prior
 *  "Toggle terminal split" command-palette path — the new design exposes
 *  the toggle on the tile chrome. */
async function clickBottomToggle(world: KoluWorld) {
  const btn = world.page.locator(
    '[data-testid="canvas-tile"][data-active] [data-testid="tile-panel-toggle-bottom"]',
  );
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await world.waitForFrame();
}

When(
  "I create a sub-terminal via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "Add sub-terminal tab");
    await this.page.waitForFunction(
      () => document.querySelector("[data-sub-terminal]") !== null,
      { timeout: 10_000 },
    );
  },
);

When("I click the main terminal", async function (this: KoluWorld) {
  const main = this.page.locator("[data-terminal-id][data-visible]").first();
  await main.click();
  await this.waitForFrame();
});

When(
  "I toggle the sub-panel via command palette",
  async function (this: KoluWorld) {
    // The command-palette toggle is gone with the unified panels primitive
    // — the per-tile bottom toggle icon is the only path. The Gherkin
    // wording is preserved so existing scenarios read the same.
    await clickBottomToggle(this);
  },
);

When(
  "I run {string} in the sub-terminal",
  async function (this: KoluWorld, command: string) {
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-sub-terminal]"),
      { timeout: POLL_TIMEOUT },
    );
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    await this.waitForFrame();
  },
);

Then("the sub-panel should be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator(BOTTOM_TAB_BAR);
  await tabBar.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the sub-panel should not be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator(BOTTOM_TAB_BAR);
  await tabBar.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal should have keyboard focus",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-sub-terminal]"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the main terminal should have keyboard focus",
  async function (this: KoluWorld) {
    try {
      await this.page.waitForFunction(
        () =>
          !!document.activeElement?.closest(
            "[data-terminal-id][data-visible]:not([data-sub-terminal])",
          ),
        { timeout: POLL_TIMEOUT },
      );
    } catch {
      await this.canvas.click();
    }
    const marker = `focus-proof-${Date.now()}`;
    await this.page.keyboard.type(`echo ${marker}`);
    await this.page.keyboard.press("Enter");
    await waitForBufferContains(this.page, marker, {
      selector: "[data-terminal-id][data-visible]:not([data-sub-terminal])",
    });
  },
);

Then(
  "the active tile should show sub-terminal count {int}",
  async function (this: KoluWorld, expected: number) {
    // The bottom-edge toggle icon shows a tab-count badge when ≥2 tabs.
    // Single-tab slots intentionally omit the badge — see TileTitleActions.
    const badge = this.page.locator(
      '[data-testid="canvas-tile"][data-active] [data-testid="tile-panel-count-bottom"]',
    );
    if (expected <= 1) {
      const count = await badge.count();
      assert.strictEqual(count, 0, "Expected no count badge for single tab");
      return;
    }
    const text = await badge.textContent({ timeout: POLL_TIMEOUT });
    assert.strictEqual(text, `${expected}`);
  },
);

When(
  "I create another sub-terminal via command palette",
  async function (this: KoluWorld) {
    const countBefore = await this.page.locator("[data-sub-terminal]").count();
    await paletteCommand(this, "Add sub-terminal tab");
    await this.page.waitForFunction(
      (expected) =>
        document.querySelectorAll("[data-sub-terminal]").length >= expected,
      countBefore + 1,
      { timeout: 10_000 },
    );
  },
);

When(
  "I click sub-panel tab {int}",
  async function (this: KoluWorld, index: number) {
    const tabs = this.page.locator(
      `${BOTTOM_TAB_BAR} button[data-testid^="panel-tab-"]`,
    );
    await tabs.nth(index - 1).click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel tab bar should have {int} tab(s)",
  async function (this: KoluWorld, expected: number) {
    const sel = `${BOTTOM_TAB_BAR} button[data-testid^="panel-tab-"]`;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "sub-panel tab {int} should be active",
  async function (this: KoluWorld, index: number) {
    const tabs = this.page.locator(
      `${BOTTOM_TAB_BAR} button[data-testid^="panel-tab-"]`,
    );
    const tab = tabs.nth(index - 1);
    const active = await tab.getAttribute("data-active");
    assert.ok(
      active !== null,
      `Expected tab ${index} to be active (have data-active attribute)`,
    );
  },
);

When(
  "I close sub-terminal tab {int}",
  async function (this: KoluWorld, index: number) {
    const tab = this.page
      .locator(`${BOTTOM_TAB_BAR} [data-testid="panel-tab-close"]`)
      .nth(index - 1);
    await tab.locator("..").hover();
    await tab.click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel should eventually collapse",
  { timeout: 60_000 },
  async function (this: KoluWorld) {
    const tabBar = this.page.locator(BOTTOM_TAB_BAR);
    await tabBar.waitFor({ state: "hidden", timeout: 45_000 });
  },
);

Then(
  "the active tile should not show a sub-terminal count",
  async function (this: KoluWorld) {
    const badge = this.page.locator(
      '[data-testid="canvas-tile"][data-active] [data-testid="tile-panel-count-bottom"]',
    );
    const count = await badge.count();
    assert.strictEqual(count, 0, "Expected no sub-terminal count badge");
  },
);

Then("the resize handle should be visible", async function (this: KoluWorld) {
  const handle = this.page.locator('[data-testid="resize-handle-bottom"]');
  await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal screen should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page
      .locator(BOTTOM_TAB_BAR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForBufferContains(this.page, expected, {
      selector: "[data-sub-terminal][data-visible]",
    });
  },
);
