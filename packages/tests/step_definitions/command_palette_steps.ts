import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

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
        .locator(`${PALETTE_SELECTOR} [role="option"]`)
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

/** Exact palette row by `data-palette-name` (rich rows lead with a glyph, so
 *  `^name` text anchors no longer match). Falls back to anchored hasText for
 *  any residual bare row without the attribute. */
function paletteOption(
  palette: import("@playwright/test").Locator,
  text: string,
) {
  const byName = palette.locator(
    `[role="option"][data-palette-name=${JSON.stringify(text)}]`,
  );
  // Playwright locators are lazy — prefer the attribute when any such row
  // exists; otherwise fall back. Callers await visibility themselves.
  return byName.or(
    palette
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(`^${escapeRegExp(text)}`) }),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

When(
  "I select {string} in the palette",
  async function (this: KoluWorld, text: string) {
    const item = paletteOption(this.page.locator(PALETTE_SELECTOR), text);
    await item.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.first().click();
  },
);

// Deliberately hold across the fleet's one-second clock update: replacing a
// row during the press cancels the browser's click synthesis.
When(
  "I click {string} in the palette across a live refresh",
  async function (this: KoluWorld, text: string) {
    const item = paletteOption(this.page.locator(PALETTE_SELECTOR), text);
    await item.first().click({ delay: 1500 });
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
    const items = this.page.locator(`${PALETTE_SELECTOR} [role="option"]`);
    const count = await items.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} palette results, got ${count}`,
    );
  },
);

Then(
  "the first palette terminal row should be {string}",
  async function (this: KoluWorld, name: string) {
    const first = this.page
      .locator(
        `${PALETTE_SELECTOR} [role="option"][data-palette-kind="terminal"]`,
      )
      .first();
    await first.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // A row can mount before its async terminal metadata label is current.
    // Visibility is setup; the label value is the condition under test.
    const actual = await pollFor({
      observe: () => first.getAttribute("data-palette-name"),
      isDone: (value) => value === name,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected first Recent terminal row "${name}" after ${elapsedMs}ms, got "${last}"`,
        ),
    });
    assert.strictEqual(
      actual,
      name,
      `Expected first Recent terminal row "${name}", got "${actual}"`,
    );
  },
);

Then(
  "palette terminal row {string} should appear before {string}",
  async function (this: KoluWorld, first: string, second: string) {
    const names = await this.page
      .locator(
        `${PALETTE_SELECTOR} [role="option"][data-palette-kind="terminal"]`,
      )
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-palette-name") ?? ""),
      );
    const i = names.indexOf(first);
    const j = names.indexOf(second);
    assert.ok(
      i >= 0,
      `Expected terminal row "${first}" in palette; got ${JSON.stringify(names)}`,
    );
    assert.ok(
      j >= 0,
      `Expected terminal row "${second}" in palette; got ${JSON.stringify(names)}`,
    );
    assert.ok(
      i < j,
      `Expected "${first}" before "${second}"; order was ${JSON.stringify(names)}`,
    );
  },
);

Then(
  "palette item {int} should be selected",
  async function (this: KoluWorld, index: number) {
    await this.page.waitForFunction(
      ([sel, idx]) => {
        const items = document.querySelectorAll(`${sel} [role="option"]`);
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
        const items = document.querySelectorAll(`${sel} [role="option"]`);
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
      .locator(`${PALETTE_SELECTOR} [role="option"]`)
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
    const item = paletteOption(palette, text);
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const content = await item.textContent();
    assert.ok(
      content?.includes("›"),
      `Expected "${text}" to have a chevron (›) but got "${content}"`,
    );
  },
);

Then(
  "palette item {string} should show shortcut {string}",
  async function (this: KoluWorld, text: string, shortcut: string) {
    const palette = this.page.locator(PALETTE_SELECTOR);
    const item = palette.locator('[role="option"]', { hasText: text });
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
  "the palette name input should show error {string}",
  async function (this: KoluWorld, fragment: string) {
    const err = this.page.locator(
      `${PALETTE_SELECTOR} [data-testid="palette-value-error"]`,
    );
    await err.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = await err.textContent();
    assert.ok(
      text?.includes(fragment),
      `Expected palette error to contain "${fragment}", got "${text}"`,
    );
  },
);

Then(
  "the palette name input should be prefilled",
  async function (this: KoluWorld) {
    const input = this.page.locator(
      `${PALETTE_SELECTOR} input[data-value-input]`,
    );
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // Prefill arrives async; poll until the value lands.
    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(`${sel} input[data-value-input]`);
        return el instanceof HTMLInputElement && el.value.length > 0;
      },
      PALETTE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "palette item {string} should be visible",
  async function (this: KoluWorld, text: string) {
    const item = paletteOption(this.page.locator(PALETTE_SELECTOR), text);
    await item.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
      () => window.__wsSent ?? [],
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

Then(
  "palette section header {string} should be visible",
  async function (this: KoluWorld, label: string) {
    const header = this.page.locator(
      `${PALETTE_SELECTOR} [data-testid="palette-section-header"]`,
      { hasText: label },
    );
    await header.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "no palette section header should be visible",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator(`${PALETTE_SELECTOR} [data-testid="palette-section-header"]`)
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no palette section headers, got ${count}`,
    );
  },
);

Then(
  "the command palette should not show kind tags",
  async function (this: KoluWorld) {
    const tags = this.page.locator(
      `${PALETTE_SELECTOR} [data-testid="palette-kind-tag"]`,
    );
    await this.page
      .locator(PALETTE_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const count = await tags.count();
    assert.strictEqual(
      count,
      0,
      `Expected no kind tags at empty root browse, found ${count}`,
    );
  },
);

Then(
  "palette item {string} should show section tag {string}",
  async function (this: KoluWorld, itemName: string, tagLabel: string) {
    // Unified switcher uses kind tags (term/host/cmd) at root search, not
    // the old per-command-section pills. Map legacy section labels → kind.
    const kind =
      tagLabel === "cmd" || tagLabel === "host" || tagLabel === "term"
        ? tagLabel
        : "cmd";
    const row = paletteOption(this.page.locator(PALETTE_SELECTOR), itemName);
    await row.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const tag = row
      .first()
      .locator('[data-testid="palette-kind-tag"]', { hasText: kind });
    await tag.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
