import { When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  SIDEBAR_ENTRY_SELECTOR,
  MOD_KEY,
  POLL_TIMEOUT,
} from "../support/world.ts";
import * as assert from "node:assert";

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
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the terminal background should be {string}",
  async function (this: KoluWorld, expectedColor: string) {
    // The terminal viewport div has inline background-color set by the active theme.
    // waitForFunction since theme change involves async reset + screen state restore.
    const expectedRgb = hexToRgb(expectedColor);
    await this.page.waitForFunction(
      (expected) => {
        const container = document.querySelector(
          '[data-testid="terminal-viewport"]',
        );
        return container
          ? getComputedStyle(container).backgroundColor === expected
          : false;
      },
      expectedRgb,
      { timeout: POLL_TIMEOUT },
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
    await themeName.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      (not) => {
        const el = document.querySelector('[data-testid="theme-name"]');
        const text = el?.textContent ?? "";
        return text.length > 0 && text !== not;
      },
      notExpected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I click the theme name in the header", async function (this: KoluWorld) {
  const themeButton = this.page.locator('[data-testid="theme-name"]');
  await themeButton.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await themeButton.click();
  await this.waitForFrame();
});

Then(
  "the header should show theme {string}",
  async function (this: KoluWorld, expectedTheme: string) {
    const themeName = this.page.locator('[data-testid="theme-name"]');
    await themeName.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      (expected) => {
        const el = document.querySelector('[data-testid="theme-name"]');
        return el?.textContent === expected;
      },
      expectedTheme,
      { timeout: POLL_TIMEOUT },
    );
  },
);
