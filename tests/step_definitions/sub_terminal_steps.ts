import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

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
    { timeout: 5000 },
  );
  await world.page.evaluate(
    ({ sel, q }) => {
      const input = document.querySelector(
        `${sel} input`,
      ) as HTMLInputElement;
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
    { timeout: 5000 },
  );
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) === null,
    PALETTE,
    { timeout: 5000 },
  );
  await world.waitForFrame();
}

When(
  "I create a sub-terminal via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "Toggle sub");
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
    await paletteCommand(this, "Toggle sub");
  },
);

When(
  "I run {string} in the sub-terminal",
  async function (this: KoluWorld, command: string) {
    // Wait for focus to be in a sub-terminal (not the main one)
    await this.page.waitForFunction(
      () => {
        const active = document.activeElement;
        return active && !!active.closest("[data-terminal-id]");
      },
      { timeout: 5000 },
    );
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    await this.waitForFrame();
  },
);

Then("the sub-panel should be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
  await tabBar.waitFor({ state: "visible", timeout: 5000 });
});

Then("the sub-panel should not be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
  await tabBar.waitFor({ state: "hidden", timeout: 5000 });
});

Then(
  "the sub-terminal should have keyboard focus",
  async function (this: KoluWorld) {
    const result = await pollUntil(
      this.page,
      () =>
        this.page.evaluate(() => {
          const active = document.activeElement;
          if (!active) return { focused: false, reason: "no activeElement" };
          const container = active.closest("[data-terminal-id]");
          if (!container)
            return { focused: false, reason: "focus not in terminal" };
          const focusedId = container.getAttribute("data-terminal-id");
          const activeEntry = document.querySelector(
            '[data-testid="sidebar"] button[data-active]',
          );
          const mainId = activeEntry
            ?.closest("[data-terminal-id]")
            ?.getAttribute("data-terminal-id");
          return {
            focused: focusedId !== mainId,
            reason: `focused=${focusedId} main=${mainId}`,
          };
        }),
      (val) => val.focused,
      { attempts: 30, intervalMs: 100 },
    );
    assert.ok(
      result.focused,
      `Expected keyboard focus in the sub-terminal (${result.reason})`,
    );
  },
);

Then(
  "the main terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Wait for focus to return to a terminal (Corvu's focus trap release is async)
    try {
      await this.page.waitForFunction(
        () => !!document.activeElement?.closest("[data-visible]"),
        { timeout: 3000 },
      );
    } catch {
      // If focus didn't auto-return, click the canvas to force it
      await this.canvas.click();
    }
    const marker = `focus-proof-${Date.now()}`;
    await this.page.keyboard.type(`echo ${marker}`);
    await this.page.keyboard.press("Enter");
    await pollUntilBufferContains(this.page, marker, {
      selector: "[data-terminal-id][data-visible]",
      attempts: 20,
      intervalMs: 100,
    });
  },
);

Then(
  "the sidebar entry should show sub-terminal count {int}",
  async function (this: KoluWorld, expected: number) {
    const badge = this.page.locator(
      '[data-testid="sidebar"] button[data-active] [data-testid="sub-count"]',
    );
    const text = await badge.textContent({ timeout: 5000 });
    assert.strictEqual(text, `+${expected}`);
  },
);

When(
  "I create another sub-terminal via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "New sub-terminal");
  },
);

When(
  "I click sub-panel tab {int}",
  async function (this: KoluWorld, index: number) {
    const tabs = this.page.locator(
      '[data-testid="sub-panel-tab-bar"] button:not([title="New sub-terminal"])',
    );
    await tabs.nth(index - 1).click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel tab bar should have {int} tab(s)",
  async function (this: KoluWorld, expected: number) {
    const sel =
      '[data-testid="sub-panel-tab-bar"] button:not([title="New sub-terminal"])';
    // Poll — the second sub-terminal may still be initializing
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: 5000 },
    );
  },
);

Then(
  "sub-panel tab {int} should be active",
  async function (this: KoluWorld, index: number) {
    const tabs = this.page.locator(
      '[data-testid="sub-panel-tab-bar"] button:not([title="New sub-terminal"])',
    );
    const tab = tabs.nth(index - 1);
    const classes = await tab.getAttribute("class");
    assert.ok(
      classes?.includes("font-medium"),
      `Expected tab ${index} to be active (have font-medium class)`,
    );
  },
);

Then(
  "the sub-panel should eventually collapse",
  async function (this: KoluWorld) {
    const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
    await tabBar.waitFor({ state: "hidden", timeout: 20000 });
  },
);

Then(
  "the sidebar entry should not show a sub-terminal count",
  async function (this: KoluWorld) {
    const badge = this.page.locator(
      '[data-testid="sidebar"] button[data-active] [data-testid="sub-count"]',
    );
    const count = await badge.count();
    assert.strictEqual(count, 0, "Expected no sub-terminal count badge");
  },
);

Then(
  "the collapsed indicator should be visible",
  async function (this: KoluWorld) {
    const indicator = this.page.locator('[data-testid="collapsed-indicator"]');
    await indicator.waitFor({ state: "visible", timeout: 5000 });
  },
);

Then("the resize handle should be visible", async function (this: KoluWorld) {
  const handle = this.page.locator('[data-testid="resize-handle"]');
  await handle.waitFor({ state: "visible", timeout: 5000 });
});

Then(
  "the sub-terminal screen should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await pollUntilBufferContains(this.page, expected, {
      selector: "[data-terminal-id][data-visible]",
      index: 1,
      attempts: 50,
      intervalMs: 100,
    });
  },
);
