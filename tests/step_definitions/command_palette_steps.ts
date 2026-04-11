import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";
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
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(text);
    // Wait for at least one result to appear (filter is synchronous in SolidJS)
    if (text.length > 0) {
      await this.page
        .locator(`${PALETTE_SELECTOR} li`)
        .first()
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT })
        .catch(() => {}); // Some filters may yield zero results
    }
  },
);

When("I clear the palette input", async function (this: KoluWorld) {
  const input = this.page.locator(`${PALETTE_SELECTOR} input`);
  await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
    await item.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.first().click();
  },
);

Then("the command palette should be visible", async function (this: KoluWorld) {
  const palette = this.page.locator(PALETTE_SELECTOR);
  await palette.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the command palette should not be visible",
  async function (this: KoluWorld) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    await palette.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
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
    await this.page.waitForFunction(
      ([sel, idx]) => {
        const items = document.querySelectorAll(`${sel} li`);
        return items[idx]?.hasAttribute("data-selected") ?? false;
      },
      [PALETTE_SELECTOR, index - 1] as const,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the last palette item should be selected",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const items = document.querySelectorAll(`${sel} li`);
        if (items.length === 0) return false;
        return items[items.length - 1]?.hasAttribute("data-selected") ?? false;
      },
      PALETTE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click breadcrumb {string} in the palette",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    const breadcrumb = palette.locator("nav button", { hasText: text });
    await breadcrumb.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await breadcrumb.click();
    // Wait for the palette items to refresh after navigating back
    await this.page
      .locator(`${PALETTE_SELECTOR} li`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the palette breadcrumb should show {string}",
  async function (this: KoluWorld, expected: string) {
    const breadcrumb = this.page.locator(`${PALETTE_SELECTOR} nav`);
    await breadcrumb.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
    await breadcrumb.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "palette item {string} should have a chevron",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    // Anchor to start of text to avoid substring matches (e.g. "Theme" vs "Random theme")
    const item = palette.locator("li", { hasText: new RegExp(`^${text}`) });
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // Focus arrives after a double-rAF; use waitForFunction instead of polling
    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(`${sel} input`);
        return el && document.activeElement === el;
      },
      PALETTE_SELECTOR,
      { timeout: POLL_TIMEOUT },
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
    await item.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "palette item {string} should not be visible",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    const item = palette
      .locator("li")
      .filter({ hasText: new RegExp(`^${text}`) });
    const count = await item.count();
    assert.strictEqual(
      count,
      0,
      `Expected no palette item matching ${JSON.stringify(text)}, got ${count}`,
    );
  },
);

Then(
  "palette hint {string} should be visible",
  async function (this: KoluWorld, text: string) {
    const hint = this.page.locator(
      `${PALETTE_SELECTOR} [data-testid="palette-hint"]`,
      { hasText: text },
    );
    await hint.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then("the palette tip should be visible", async function (this: KoluWorld) {
  const tip = this.page.locator(
    `${PALETTE_SELECTOR} [data-testid="palette-tip"]`,
  );
  await tip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("no palette tip should be visible", async function (this: KoluWorld) {
  const count = await this.page
    .locator(`${PALETTE_SELECTOR} [data-testid="palette-tip"]`)
    .count();
  assert.strictEqual(count, 0, `Expected no palette tip, got ${count}`);
});

Then("no palette hint should be visible", async function (this: KoluWorld) {
  const count = await this.page
    .locator(`${PALETTE_SELECTOR} [data-testid="palette-hint"]`)
    .count();
  assert.strictEqual(count, 0, `Expected no palette hints, got ${count}`);
});

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
