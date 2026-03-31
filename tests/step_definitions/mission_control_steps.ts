import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

const MC_SELECTOR = '[data-testid="mission-control"]';
const MC_CARD_SELECTOR = '[data-testid="mission-control-card"]';

When("I click the Mission Control icon", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="mission-control-trigger"]').click();
});

When(
  "I click terminal card {int}",
  async function (this: KoluWorld, index: number) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    await cards.nth(index - 1).click();
  },
);

Then("Mission Control should be visible", async function (this: KoluWorld) {
  const mc = this.page.locator(MC_SELECTOR);
  await mc.waitFor({ state: "visible", timeout: 3000 });
});

Then("Mission Control should not be visible", async function (this: KoluWorld) {
  const mc = this.page.locator(MC_SELECTOR);
  await mc.waitFor({ state: "hidden", timeout: 3000 });
});

Then(
  "Mission Control should show {int} terminal card(s)",
  async function (this: KoluWorld, expected: number) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    await cards.nth(expected - 1).waitFor({ state: "visible", timeout: 5000 });
    const count = await cards.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} terminal cards, got ${count}`,
    );
  },
);

Then(
  "Mission Control should have an active card",
  async function (this: KoluWorld) {
    const activeCard = this.page.locator(`${MC_CARD_SELECTOR}[data-active]`);
    await activeCard.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "Mission Control should show terminal previews",
  async function (this: KoluWorld) {
    const previews = this.page.locator('[data-testid="terminal-preview"]');
    await previews.first().waitFor({ state: "visible", timeout: 5000 });
    const count = await previews.count();
    assert.ok(count > 0, "Expected at least one terminal preview");
  },
);

Then(
  "Mission Control card {int} should show number {string}",
  async function (this: KoluWorld, index: number, expected: string) {
    const card = this.page.locator(MC_CARD_SELECTOR).nth(index - 1);
    const badge = card.locator('[data-testid="card-number"]');
    await badge.waitFor({ state: "visible", timeout: 3000 });
    const text = await badge.textContent();
    assert.strictEqual(
      text?.trim(),
      expected,
      `Expected card ${index} badge to show "${expected}", got "${text}"`,
    );
  },
);

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

When("I hold Ctrl and press Tab", async function (this: KoluWorld) {
  await this.page.keyboard.down("Control");
  await this.page.keyboard.press("Tab");
  await this.waitForFrame();
});

When("I hold Ctrl and Shift and press Tab", async function (this: KoluWorld) {
  await this.page.keyboard.down("Control");
  await this.page.keyboard.press("Shift+Tab");
  await this.waitForFrame();
});

When("I release Ctrl", async function (this: KoluWorld) {
  await this.page.keyboard.up("Control");
  await this.waitForFrame();
});

When("I press the Mission Control shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+.`);
});

Then("the active card should have focus", async function (this: KoluWorld) {
  // Wait for auto-focus (setTimeout in MissionControl runs after Corvu's focus trap)
  await this.page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "mission-control-card",
    { timeout: 3000 },
  );
});

Then(
  "Mission Control card {int} should have focus",
  async function (this: KoluWorld, index: number) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    const card = cards.nth(index - 1);
    const id = await card.getAttribute("data-terminal-id");
    const focusedId = await this.page.evaluate(() =>
      document.activeElement?.getAttribute("data-terminal-id"),
    );
    assert.strictEqual(
      focusedId,
      id,
      `Expected card ${index} to have focus (terminal ${id}), but focused terminal is ${focusedId}`,
    );
  },
);

Then(
  "the last Mission Control card should have focus",
  async function (this: KoluWorld) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    const count = await cards.count();
    const last = cards.nth(count - 1);
    const id = await last.getAttribute("data-terminal-id");
    const focusedId = await this.page.evaluate(() =>
      document.activeElement?.getAttribute("data-terminal-id"),
    );
    assert.strictEqual(
      focusedId,
      id,
      `Expected last card to have focus (terminal ${id}), but focused terminal is ${focusedId}`,
    );
  },
);

Then(
  "all Mission Control cards should be visible",
  async function (this: KoluWorld) {
    const cards = this.page.locator(MC_CARD_SELECTOR);
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const visible = await cards.nth(i).isVisible();
      assert.ok(visible, `Mission Control card ${i + 1} is not visible`);
    }
  },
);
