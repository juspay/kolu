import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

/** Open command palette, search for a command, and execute it. */
async function paletteCommand(world: KoluWorld, query: string) {
  await world.page.keyboard.press(`${MOD_KEY}+k`);
  await world.page.waitForTimeout(200);
  const palette = world.page.locator('[data-testid="command-palette"]');
  await palette.locator("input").fill(query);
  await world.page.waitForTimeout(200);
  await world.page.keyboard.press("Enter");
  await world.page.waitForTimeout(500);
}

When(
  "I create a sub-terminal via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "Toggle sub");
  },
);

When("I click the main terminal", async function (this: KoluWorld) {
  // Click the main terminal's xterm container (first data-visible terminal)
  const main = this.page.locator("[data-terminal-id][data-visible]").first();
  await main.click();
  await this.page.waitForTimeout(300);
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
    // Focus should already be in the sub-terminal
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    await this.page.waitForTimeout(500);
  },
);

Then("the sub-panel should be visible", async function (this: KoluWorld) {
  // Sub-panel tab bar is visible when expanded
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
    // Poll until focus settles in the sub-terminal (xterm focus can be slow under load)
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
      { attempts: 30, intervalMs: 300 },
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
    await this.page.waitForTimeout(300);
    // Type a unique marker and verify it appears in the main terminal's buffer
    const marker = `focus-proof-${Date.now()}`;
    await this.page.keyboard.type(`echo ${marker}`);
    await this.page.keyboard.press("Enter");
    // Poll the first visible terminal's buffer for the marker
    await pollUntilBufferContains(this, marker, {
      selector: "[data-terminal-id][data-visible]",
      attempts: 20,
      intervalMs: 300,
    });
  },
);

Then(
  "the sidebar entry should show sub-terminal count {int}",
  async function (this: KoluWorld, expected: number) {
    // Look for the +N badge text in the active sidebar entry
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
    await this.page.waitForTimeout(300);
  },
);

Then(
  "the sub-panel tab bar should have {int} tab(s)",
  async function (this: KoluWorld, expected: number) {
    const tabs = this.page.locator(
      '[data-testid="sub-panel-tab-bar"] button:not([title="New sub-terminal"])',
    );
    const count = await tabs.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} sub-panel tabs, got ${count}`,
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
    // Poll for the sub-panel tab bar to disappear (sub-terminal exited)
    const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!(await tabBar.isVisible())) return;
      await this.page.waitForTimeout(500);
    }
    assert.fail("Sub-panel did not collapse after sub-terminal exit");
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
    // Sub-terminal is the second visible terminal container (index 1)
    await pollUntilBufferContains(this, expected, {
      selector: "[data-terminal-id][data-visible]",
      index: 1,
      attempts: 20,
      intervalMs: 300,
    });
  },
);
