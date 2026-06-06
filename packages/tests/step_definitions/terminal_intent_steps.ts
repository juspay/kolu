import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const SLOT =
  '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]';
const EDITOR = '[data-testid="intent-editor-textarea"]';
const SAVE = '[data-testid="intent-editor-save"]';
const CLEAR = '[data-testid="intent-editor-clear"]';
const QUICK = '[data-testid="intent-editor-quick"]';

When(
  "I click the active terminal annotation slot",
  async function (this: KoluWorld) {
    const slot = this.page.locator(SLOT).first();
    await slot.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await slot.click({ force: true });
    await this.waitForFrame();
  },
);

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
        return ta?.value.includes(want);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active terminal annotation slot should start with {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (want) => {
        const slot = document.querySelector(
          '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]',
        );
        const text = (slot?.textContent ?? "").trim();
        return text.startsWith(want);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// The annotation slot is the package's links-OFF inline variant: its own click
// handler (open the intent editor) must win, so a markdown link must degrade to
// inert text — no `<a>` survives the sanitize pass. The slot's text still shows
// the link label, asserted alongside this in the scenario.
Then(
  "the active terminal annotation slot should render no anchor",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const slot = document.querySelector(
          '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]',
        );
        return slot !== null && slot.querySelector("a") === null;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active terminal annotation slot should show the placeholder",
  async function (this: KoluWorld) {
    // Placeholder state: no intent, no git → slot shows an em-dash so
    // it's still visible and clickable (the user can add an intent
    // even when the terminal isn't in a git repo).
    await this.page.waitForFunction(
      () => {
        const slot = document.querySelector(
          '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]',
        );
        return (slot?.textContent ?? "").trim() === "—";
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
