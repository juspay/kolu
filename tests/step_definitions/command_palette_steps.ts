import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY } from "../support/world.ts";
import * as assert from "node:assert";
const PALETTE_SELECTOR = '[data-testid="command-palette"]';

When("I open the command palette", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+k`);
  await this.waitForFrame();
});

When("I press {word}", async function (this: KoluWorld, key: string) {
  await this.page.keyboard.press(key);
  await this.waitForFrame();
});

When("I click outside the command palette", async function (this: KoluWorld) {
  await this.page.mouse.click(10, 10);
  await this.waitForFrame();
});

When(
  "I type {string} in the palette",
  async function (this: KoluWorld, text: string) {
    const input = this.page.locator(`${PALETTE_SELECTOR} input`);
    await input.waitFor({ state: "visible", timeout: 3000 });
    await input.fill(text);
    // Wait for at least one result to appear (filter is synchronous in SolidJS)
    if (text.length > 0) {
      await this.page
        .locator(`${PALETTE_SELECTOR} li`)
        .first()
        .waitFor({ state: "visible", timeout: 3000 })
        .catch(() => {}); // Some filters may yield zero results
    }
  },
);

When("I clear the palette input", async function (this: KoluWorld) {
  const input = this.page.locator(`${PALETTE_SELECTOR} input`);
  await input.waitFor({ state: "visible", timeout: 3000 });
  await input.fill("");
});

When(
  "I select {string} in the palette",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    // Use exact text match to avoid ambiguity (e.g. "Nord" vs "One Nord")
    const item = palette
      .locator("li")
      .filter({ hasText: new RegExp(`^${text}`) });
    await item.first().waitFor({ state: "visible", timeout: 3000 });
    await item.first().click();
  },
);

Then("the command palette should be visible", async function (this: KoluWorld) {
  const palette = this.page.locator(PALETTE_SELECTOR);
  await palette.waitFor({ state: "visible", timeout: 3000 });
});

Then(
  "the command palette should not be visible",
  async function (this: KoluWorld) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    await palette.waitFor({ state: "hidden", timeout: 3000 });
  },
);

Then(
  "the command palette should show {int} result(s)",
  async function (this: KoluWorld, expected: number) {
    const items = this.page.locator(`${PALETTE_SELECTOR} li`);
    const count = await items.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} palette results, got ${count}`,
    );
  },
);

Then(
  "palette item {int} should be selected",
  async function (this: KoluWorld, index: number) {
    // Selected item has bg-surface-3 class (0-based internally, 1-based in feature)
    const items = this.page.locator(`${PALETTE_SELECTOR} li`);
    const item = items.nth(index - 1);
    await item.waitFor({ state: "visible", timeout: 3000 });
    const classes = await item.getAttribute("class");
    assert.ok(
      classes?.includes("bg-surface-3"),
      `Palette item ${index} is not selected (classes: ${classes})`,
    );
  },
);

Then(
  "the last palette item should be selected",
  async function (this: KoluWorld) {
    const items = this.page.locator(`${PALETTE_SELECTOR} li`);
    const count = await items.count();
    const last = items.nth(count - 1);
    const classes = await last.getAttribute("class");
    assert.ok(
      classes?.includes("bg-surface-3"),
      `Last palette item is not selected (classes: ${classes})`,
    );
  },
);

When(
  "I click breadcrumb {string} in the palette",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    const breadcrumb = palette.locator("nav button", { hasText: text });
    await breadcrumb.waitFor({ state: "visible", timeout: 3000 });
    await breadcrumb.click();
    // Wait for the palette items to refresh after navigating back
    await this.page
      .locator(`${PALETTE_SELECTOR} li`)
      .first()
      .waitFor({ state: "visible", timeout: 3000 });
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
  "the palette breadcrumb should not be visible",
  async function (this: KoluWorld) {
    const breadcrumb = this.page.locator(`${PALETTE_SELECTOR} nav`);
    await assert.rejects(
      breadcrumb.waitFor({ state: "visible", timeout: 500 }),
    );
  },
);

Then(
  "palette item {string} should have a chevron",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    // Anchor to start of text to avoid substring matches (e.g. "Theme" vs "Random theme")
    const item = palette.locator("li", { hasText: new RegExp(`^${text}`) });
    await item.waitFor({ state: "visible", timeout: 3000 });
    const content = await item.textContent();
    assert.ok(
      content?.includes("→"),
      `Expected "${text}" to have a chevron (→) but got "${content}"`,
    );
  },
);

Then(
  "palette item {string} should show shortcut {string}",
  async function (this: KoluWorld, text: string, shortcut: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    const item = palette.locator("li", { hasText: text });
    await item.waitFor({ state: "visible", timeout: 3000 });
    const kbd = item.locator("kbd").first();
    const kbdText = await kbd.textContent();
    assert.ok(
      kbdText?.includes(shortcut),
      `Expected "${text}" to show shortcut "${shortcut}" but got "${kbdText}"`,
    );
  },
);

Then(
  "the palette search input should be focused",
  async function (this: KoluWorld) {
    const input = this.page.locator(`${PALETTE_SELECTOR} input`);
    await input.waitFor({ state: "visible", timeout: 3000 });
    // Focus arrives after a double-rAF; use waitForFunction instead of polling
    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(`${sel} input`);
        return el && document.activeElement === el;
      },
      PALETTE_SELECTOR,
      { timeout: 3000 },
    );
  },
);

Then(
  "palette item {string} should be visible",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    const item = palette
      .locator("li")
      .filter({ hasText: new RegExp(`^${text}`) });
    await item.first().waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "no sendInput call should contain {string}",
  async function (this: KoluWorld, key: string) {
    const messages: string[] = await this.page.evaluate(
      () => (window as any).__wsSent ?? [],
    );
    for (const msg of messages) {
      if (!msg.includes("sendInput")) continue;
      assert.ok(
        !msg.includes(`"data":"${key}"`),
        `Keystroke "${key}" leaked via sendInput: ${msg}`,
      );
    }
  },
);
