import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const PALETTE = '[data-testid="command-palette"]';

/**
 * Open command palette, fill a query, click the first result, wait for close.
 * Uses evaluate to fill the input and click the result because Corvu's dialog
 * content visibility is state-based — Playwright's actionability checks see
 * elements as "hidden" during the open transition even with CSS animations
 * disabled. The evaluate approach bypasses these checks entirely.
 */
async function paletteCommand(world: KoluWorld, query: string) {
  // Ensure focus is in the app (previous palette close may leave focus nowhere)
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
      // Bypass Solid's reactivity by calling the native HTMLInputElement.value
      // setter directly. Both lookups should always succeed in a real browser
      // — the explicit guards turn an environmental misconfiguration into a
      // descriptive throw rather than `Cannot read properties of undefined`.
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      const nativeSet = descriptor?.set;
      if (!nativeSet) throw new Error("HTMLInputElement.value setter missing");
      nativeSet.call(input, q);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: PALETTE, q: query },
  );
  await world.page.waitForFunction(
    (sel) => {
      const item = document.querySelector(`${sel} li`) as HTMLElement | null;
      if (!item?.offsetHeight) return false;
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
  // Wait for focus to land in a terminal — Corvu's focus trap release is async
  // and waitForFrame (2x rAF) is insufficient on loaded CI.
  await world.page.waitForFunction(
    () => !!document.activeElement?.closest("[data-terminal-id]"),
    { timeout: POLL_TIMEOUT },
  );
}

When(
  "I create a sub-terminal via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "Toggle terminal split");
    // handleCreateSubTerminal is async (RPC) but onSelect is fire-and-forget.
    // Wait for the sub-terminal to actually exist before proceeding — otherwise
    // the next "toggle" command may see no subs and create again instead.
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
    await paletteCommand(this, "Toggle terminal split");
  },
);

When(
  "I run {string} in the sub-terminal",
  async function (this: KoluWorld, command: string) {
    // Wait for focus to be specifically in a sub-terminal, not the main one
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
  const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
  await tabBar.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the sub-panel should not be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
  await tabBar.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Wait for focus to land inside a [data-sub-terminal] container directly —
    // no indirect ID comparison with the pill tree's active entry.
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-sub-terminal]"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the main terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Wait for focus to land specifically in a main terminal (not sub-terminal).
    // [data-visible] alone is too broad — matches any visible element.
    // Corvu's focus trap release is async; fall back to clicking the canvas.
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
    const badge = this.page.locator(
      '[data-testid="canvas-tile"][data-active] [data-testid="sub-count"]',
    );
    const text = await badge.textContent({ timeout: POLL_TIMEOUT });
    assert.strictEqual(text, `${expected}`);
  },
);

When(
  "I create another sub-terminal via command palette",
  async function (this: KoluWorld) {
    const countBefore = await this.page.locator("[data-sub-terminal]").count();
    await paletteCommand(this, "Split terminal");
    // Wait for the new sub-terminal to mount (async RPC creation)
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
      '[data-testid="sub-panel-tab-bar"] button:not([title])',
    );
    await tabs.nth(index - 1).click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel tab bar should have {int} tab(s)",
  async function (this: KoluWorld, expected: number) {
    const sel = '[data-testid="sub-panel-tab-bar"] button:not([title])';
    // Poll — the second sub-terminal may still be initializing
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
      '[data-testid="sub-panel-tab-bar"] button:not([title])',
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
      .locator(
        '[data-testid="sub-panel-tab-bar"] [data-testid="sub-tab-close"]',
      )
      .nth(index - 1);
    // Hover the parent to reveal the close button, then click.
    // Splits close directly — no confirmation dialog.
    await tab.locator("..").hover();
    await tab.click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel should eventually collapse",
  { timeout: 60_000 },
  async function (this: KoluWorld) {
    const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
    await tabBar.waitFor({ state: "hidden", timeout: 45_000 });
  },
);

Then(
  "the active tile should not show a sub-terminal count",
  async function (this: KoluWorld) {
    const badge = this.page.locator(
      '[data-testid="canvas-tile"][data-active] [data-testid="sub-count"]',
    );
    const count = await badge.count();
    assert.strictEqual(count, 0, "Expected no sub-terminal count badge");
  },
);

Then(
  "the collapsed indicator should be visible",
  async function (this: KoluWorld) {
    // First wait for the tab bar to disappear (confirms collapse state settled)
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]')
      .waitFor({ state: "hidden", timeout: 10_000 });
    // Then wait for the collapsed strip to mount and be visible
    const indicator = this.page.locator('[data-testid="collapsed-indicator"]');
    await indicator.waitFor({ state: "visible", timeout: 10_000 });
  },
);

Then("the resize handle should be visible", async function (this: KoluWorld) {
  // Handle is an invisible hit zone (h-0 with ::before pseudo-element) — check attached, not visible
  const handle = this.page.locator('[data-testid="resize-handle"]');
  await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal screen should contain {string}",
  async function (this: KoluWorld, expected: string) {
    // Wait for sub-panel to be fully expanded before reading buffer
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForBufferContains(this.page, expected, {
      selector: "[data-sub-terminal][data-visible]",
    });
  },
);
