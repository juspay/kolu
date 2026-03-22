import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";

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
    // The terminal container div uses inline style background-color from the active theme.
    // Poll since the theme change involves an async reset + screen state restore.
    const container = this.page.locator("[data-visible]");
    let bgColor = "";
    for (let i = 0; i < 20; i++) {
      bgColor = await container.evaluate((el) => {
        // Walk up to find the container with inline background-color
        const parent = el.closest("[style]");
        return parent ? getComputedStyle(parent).backgroundColor : "";
      });
      // Convert expected hex to rgb for comparison
      const r = parseInt(expectedColor.slice(1, 3), 16);
      const g = parseInt(expectedColor.slice(3, 5), 16);
      const b = parseInt(expectedColor.slice(5, 7), 16);
      const expectedRgb = `rgb(${r}, ${g}, ${b})`;
      if (bgColor === expectedRgb) return;
      await this.page.waitForTimeout(300);
    }
    assert.fail(
      `Expected terminal background ${expectedColor} but got ${bgColor}`,
    );
  },
);

Then(
  "the header should show theme {string}",
  async function (this: KoluWorld, expectedTheme: string) {
    const header = this.page.locator("header");
    await header.waitFor({ state: "visible", timeout: 5_000 });
    // Poll for theme text to appear (may take a moment after palette action)
    let text = "";
    for (let i = 0; i < 10; i++) {
      text = (await header.textContent()) ?? "";
      if (text.includes(expectedTheme)) return;
      await this.page.waitForTimeout(300);
    }
    assert.ok(
      text.includes(expectedTheme),
      `Expected header to contain "${expectedTheme}" but got "${text}"`,
    );
  },
);
