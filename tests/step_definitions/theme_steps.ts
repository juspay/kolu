import { When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  SIDEBAR_ENTRY_SELECTOR,
  MOD_KEY,
} from "../support/world.ts";
import * as assert from "node:assert";
import { pollUntil } from "../support/poll.ts";

/** Convert "#rrggbb" to "rgb(r, g, b)" for comparison with getComputedStyle. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff})`;
}

/** Select a terminal by its position in the sidebar (1-based), regardless of createdTerminalIds. */
When(
  "I select sidebar entry {int}",
  async function (this: KoluWorld, position: number) {
    const entry = this.page.locator(SIDEBAR_ENTRY_SELECTOR).nth(position - 1);
    await entry.click();
    const id = await entry.getAttribute("data-terminal-id");
    assert.ok(id, `Sidebar entry ${position} has no terminal ID`);
    await this.page
      .locator(`[data-terminal-id="${id}"][data-visible]`)
      .waitFor({ state: "attached", timeout: 5000 });
  },
);

Then(
  "the terminal background should be {string}",
  async function (this: KoluWorld, expectedColor: string) {
    // The terminal viewport div has inline background-color set by the active theme.
    // Poll since theme change involves async reset + screen state restore.
    const expectedRgb = hexToRgb(expectedColor);
    const bgColor = await pollUntil(
      this.page,
      () =>
        this.page.evaluate(() => {
          const container = document.querySelector(
            '[data-testid="terminal-viewport"]',
          );
          return container ? getComputedStyle(container).backgroundColor : "";
        }),
      (bg) => bg === expectedRgb,
      { attempts: 50 },
    );
    assert.strictEqual(
      bgColor,
      expectedRgb,
      `Expected terminal background ${expectedColor}`,
    );
  },
);

When("I press the random theme shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+j`);
  await this.waitForFrame();
});

Then(
  "the header theme should differ from {string}",
  async function (this: KoluWorld, notExpected: string) {
    const themeName = this.page.locator('[data-testid="theme-name"]');
    await themeName.waitFor({ state: "visible", timeout: 5_000 });
    const text = await pollUntil(
      this.page,
      async () => (await themeName.textContent()) ?? "",
      (t) => t !== notExpected,
      { attempts: 30 },
    );
    assert.ok(
      text !== notExpected,
      `Expected theme to differ from "${notExpected}" but got "${text}"`,
    );
  },
);

When("I click the theme name in the header", async function (this: KoluWorld) {
  const themeButton = this.page.locator('[data-testid="theme-name"]');
  await themeButton.waitFor({ state: "visible", timeout: 3000 });
  await themeButton.click();
  await this.waitForFrame();
});

Then(
  "the header should show theme {string}",
  async function (this: KoluWorld, expectedTheme: string) {
    const themeName = this.page.locator('[data-testid="theme-name"]');
    await themeName.waitFor({ state: "visible", timeout: 5_000 });
    const text = await pollUntil(
      this.page,
      async () => (await themeName.textContent()) ?? "",
      (t) => t === expectedTheme,
      { attempts: 30 },
    );
    assert.strictEqual(
      text,
      expectedTheme,
      `Expected theme "${expectedTheme}" but got "${text}"`,
    );
  },
);
