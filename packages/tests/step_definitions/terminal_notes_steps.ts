import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const SLOT =
  '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]';
const EDITOR = '[data-testid="notes-editor-textarea"]';
const CLEAR = '[data-testid="notes-editor-clear"]';
const QUICK = '[data-testid="notes-editor-quick"]';

When(
  "I click the active terminal annotation slot",
  async function (this: KoluWorld) {
    const slot = this.page.locator(SLOT).first();
    await slot.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await slot.click({ force: true });
    await this.waitForFrame();
  },
);

Then("the notes editor should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(EDITOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the notes editor textarea should be focused",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="notes-editor-textarea"]',
        );
        return el !== null && document.activeElement === el;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I type {string} into the notes editor",
  async function (this: KoluWorld, value: string) {
    // Translate literal `\n` in the .feature string into real newlines.
    const text = value.replace(/\\n/g, "\n");
    const ta = this.page.locator(EDITOR);
    await ta.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ta.fill(text);
  },
);

When("I clear the notes", async function (this: KoluWorld) {
  const btn = this.page.locator(CLEAR);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click({ force: true });
  // Wait for the autosave flush to clear the persisted value (the
  // textarea mirrors the draft synchronously; the round-trip clears
  // the annotation slot, which the following step asserts).
  await this.page.waitForFunction(
    () => {
      const ta = document.querySelector(
        '[data-testid="notes-editor-textarea"]',
      ) as HTMLTextAreaElement | null;
      return ta?.value === "";
    },
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
  "the notes editor textarea should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (want) => {
        const ta = document.querySelector(
          '[data-testid="notes-editor-textarea"]',
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
// handler (open the Notes tab) must win, so a markdown link must degrade to
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
    // Placeholder state: no notes, no git → slot shows an em-dash so
    // it's still visible and clickable (the user can add notes
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
