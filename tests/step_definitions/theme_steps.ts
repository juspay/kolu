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

Then(
  "the header should have a light background",
  async function (this: KoluWorld) {
    const header = this.page.locator("header");
    await header.waitFor({ state: "visible", timeout: 5_000 });
    // Wait for theme to apply
    await this.page.waitForTimeout(500);
    // Get the computed background-color and check it's "light" (luminance > 0.2)
    const bgColor = await header.evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // Parse rgb(r, g, b) → luminance
    const match = bgColor.match(/(\d+),\s*(\d+),\s*(\d+)/);
    assert.ok(match, `Could not parse background color: ${bgColor}`);
    const [r, g, b] = [match[1], match[2], match[3]].map(Number);
    // Relative luminance (simplified sRGB)
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    assert.ok(
      luminance > 0.2,
      `Expected light header background but got ${bgColor} (luminance: ${luminance.toFixed(3)})`,
    );
  },
);
