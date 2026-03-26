import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
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
    // The terminal area's parent container div has inline background-color.
    // Poll since theme change involves async reset + screen state restore.
    const expectedRgb = hexToRgb(expectedColor);
    const bgColor = await pollUntil(
      this.page,
      () =>
        this.page.evaluate(() => {
          const el = document.querySelector("[data-visible]");
          const container = el?.parentElement?.closest("[style]");
          return container ? getComputedStyle(container).backgroundColor : "";
        }),
      (bg) => bg === expectedRgb,
      { attempts: 20 },
    );
    assert.strictEqual(
      bgColor,
      expectedRgb,
      `Expected terminal background ${expectedColor}`,
    );
  },
);

const PALETTE_SELECTOR = '[data-testid="command-palette"]';

When("I click the theme name in the header", async function (this: KoluWorld) {
  const themeButton = this.page.locator('[data-testid="theme-name"]');
  await themeButton.waitFor({ state: "visible", timeout: 3000 });
  await themeButton.click();
  await this.page.waitForTimeout(200);
});

Then(
  "the palette input should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const input = this.page.locator(`${PALETTE_SELECTOR} input`);
    await input.waitFor({ state: "visible", timeout: 3000 });
    const value = await input.inputValue();
    assert.strictEqual(
      value,
      expected,
      `Expected palette input to contain "${expected}" but got "${value}"`,
    );
  },
);

Then(
  "the palette breadcrumb should show {string}",
  async function (this: KoluWorld, expected: string) {
    const breadcrumb = this.page.locator(`${PALETTE_SELECTOR} nav`);
    await breadcrumb.waitFor({ state: "visible", timeout: 3000 });
    const text = await breadcrumb.textContent();
    assert.ok(
      text?.includes(expected),
      `Expected breadcrumb to contain "${expected}" but got "${text}"`,
    );
  },
);

Then(
  "the header should show theme {string}",
  async function (this: KoluWorld, expectedTheme: string) {
    const header = this.page.locator("header");
    await header.waitFor({ state: "visible", timeout: 5_000 });
    const text = await pollUntil(
      this.page,
      async () => (await header.textContent()) ?? "",
      (t) => t.includes(expectedTheme),
      { attempts: 30 },
    );
    assert.ok(
      text.includes(expectedTheme),
      `Expected header to contain "${expectedTheme}" but got "${text}"`,
    );
  },
);
