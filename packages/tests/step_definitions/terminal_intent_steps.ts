import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CHIP =
  '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-intent-chip"]';
const EDITOR = '[data-testid="intent-editor-textarea"]';
const SAVE = '[data-testid="intent-editor-save"]';
const CLEAR = '[data-testid="intent-editor-clear"]';
const QUICK = '[data-testid="intent-editor-quick"]';

When("I click the terminal intent chip", async function (this: KoluWorld) {
  const chip = this.page.locator(CHIP).first();
  await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await chip.click({ force: true });
  await this.waitForFrame();
});

Then("the intent editor should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(EDITOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the intent editor textarea should be focused",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="intent-editor-textarea"]',
        );
        return el !== null && document.activeElement === el;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I type {string} into the intent editor",
  async function (this: KoluWorld, value: string) {
    // Translate literal `\n` in the .feature string into real newlines.
    const text = value.replace(/\\n/g, "\n");
    const ta = this.page.locator(EDITOR);
    await ta.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ta.fill(text);
  },
);

When("I save the intent", async function (this: KoluWorld) {
  const btn = this.page.locator(SAVE);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click({ force: true });
  // Wait for the editor to close (RPC round-trip + dialog dismiss).
  await this.page.waitForFunction(
    () =>
      document.querySelector('[data-testid="intent-editor-textarea"]') === null,
    undefined,
    { timeout: POLL_TIMEOUT },
  );
});

When("I clear the intent", async function (this: KoluWorld) {
  const btn = this.page.locator(CLEAR);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click({ force: true });
  await this.page.waitForFunction(
    () =>
      document.querySelector('[data-testid="intent-editor-textarea"]') === null,
    undefined,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I click the quick-row emoji {string}",
  async function (this: KoluWorld, glyph: string) {
    const btn = this.page.locator(`${QUICK}[data-glyph="${glyph}"]`).first();
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click({ force: true });
  },
);

Then(
  "the intent editor textarea should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (want) => {
        const ta = document.querySelector(
          '[data-testid="intent-editor-textarea"]',
        ) as HTMLTextAreaElement | null;
        return ta !== null && ta.value.includes(want);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active tile should show the intent tag {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (want) => {
        const chip = document.querySelector(
          '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-intent-chip"] [data-testid="terminal-tag"]',
        );
        return chip?.textContent === want;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the terminal intent chip should show the placeholder",
  async function (this: KoluWorld) {
    // Placeholder state: chip is present but no terminal-tag span has rendered
    // (the `<Show fallback=...>` falls through to the "＋" glyph).
    await this.page.waitForFunction(
      () => {
        const chip = document.querySelector(
          '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-intent-chip"]',
        );
        if (!chip) return false;
        return chip.querySelector('[data-testid="terminal-tag"]') === null;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
