import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
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
    // Let focus settle (rAF in TerminalPane + xterm focus)
    await this.page.waitForTimeout(500);
    // The focused element should be inside the sub-panel area (second Resizable.Panel),
    // not the main terminal. We identify this by checking that the focused terminal's ID
    // differs from the main terminal (first sidebar entry).
    const result = await this.page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return { focused: false, reason: "no activeElement" };
      const container = active.closest("[data-terminal-id]");
      if (!container)
        return { focused: false, reason: "focus not in terminal" };
      const focusedId = container.getAttribute("data-terminal-id");
      // The main terminal is the one matching the active sidebar entry
      const activeEntry = document.querySelector(
        '[data-testid="sidebar"] button[class*="bg-surface-2"]',
      );
      const mainId = activeEntry
        ?.closest("[data-terminal-id]")
        ?.getAttribute("data-terminal-id");
      return {
        focused: focusedId !== mainId,
        reason: `focused=${focusedId} main=${mainId}`,
      };
    });
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
    // Type a unique marker and verify it appears in the main terminal's screen state
    const marker = `focus-proof-${Date.now()}`;
    await this.page.keyboard.type(`echo ${marker}`);
    await this.page.keyboard.press("Enter");
    // Get the main terminal ID (active sidebar entry)
    const mainId = await this.page.evaluate(() => {
      const entry = document.querySelector(
        '[data-testid="sidebar"] button[class*="bg-surface-2"]',
      );
      return entry
        ?.closest("[data-terminal-id]")
        ?.getAttribute("data-terminal-id");
    });
    assert.ok(mainId, "Could not find main terminal ID");
    // Poll screen state for the marker
    for (let attempt = 0; attempt < 20; attempt++) {
      const resp = await this.page.request.fetch("/rpc/terminal/screenState", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ json: { id: mainId } }),
      });
      const body = await resp.json();
      const screen =
        typeof body.json === "string" ? body.json : JSON.stringify(body);
      if (screen.includes(marker)) return;
      await this.page.waitForTimeout(300);
    }
    assert.fail(`Main terminal did not receive keystrokes (marker: ${marker})`);
  },
);

Then(
  "the sidebar entry should show sub-terminal count {int}",
  async function (this: KoluWorld, expected: number) {
    // Look for the +N badge text in the active sidebar entry
    const badge = this.page.locator(
      '[data-testid="sidebar"] button[class*="bg-surface-2"] [data-testid="sub-count"]',
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
      '[data-testid="sidebar"] button[class*="bg-surface-2"] [data-testid="sub-count"]',
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
    // Find visible sub-terminal (not the first visible terminal)
    const found = await this.page.evaluate(
      ({ expected }) => {
        const visibleTerminals = document.querySelectorAll(
          "[data-terminal-id][data-visible]",
        );
        if (visibleTerminals.length < 2) return false;
        // Sub-terminal is the second visible one
        const subContainer = visibleTerminals[1];
        const text = subContainer?.textContent ?? "";
        return text.includes(expected);
      },
      { expected },
    );
    // If not found in DOM text, check via screen state API
    if (!found) {
      // Poll screen state for the sub-terminal
      for (let attempt = 0; attempt < 20; attempt++) {
        const visibleIds = await this.page.evaluate(() =>
          Array.from(
            document.querySelectorAll("[data-terminal-id][data-visible]"),
          ).map((el) => el.getAttribute("data-terminal-id")),
        );
        const subId = visibleIds[1]; // second visible terminal
        if (!subId) {
          await this.page.waitForTimeout(300);
          continue;
        }
        const resp = await this.page.request.fetch(
          "/rpc/terminal/screenState",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ json: { id: subId } }),
          },
        );
        const body = await resp.json();
        const screenState =
          typeof body.json === "string" ? body.json : JSON.stringify(body);
        if (screenState.includes(expected)) return;
        await this.page.waitForTimeout(300);
      }
      assert.fail(
        `Sub-terminal screen does not contain "${expected}" after retries`,
      );
    }
  },
);
