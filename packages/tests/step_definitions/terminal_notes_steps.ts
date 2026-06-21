import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const SLOT =
  '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]';
const NOTE_ICON =
  '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-note-icon"]';
const EDITOR = '[data-testid="notes-editor-textarea"]';
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
    // No Save button — the editor autosaves (debounced). Assertions that
    // follow (`slot should start with …`) poll until the write propagates.
  },
);

When("I clear the notes", async function (this: KoluWorld) {
  // Emptying the textarea is the clear gesture — the autosave persists "",
  // which the server coerces to "no notes".
  const ta = this.page.locator(EDITOR);
  await ta.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await ta.fill("");
});

When(
  "I click the quick-row emoji {string}",
  async function (this: KoluWorld, glyph: string) {
    const btn = this.page.locator(`${QUICK}[data-glyph="${glyph}"]`).first();
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click({ force: true });
  },
);

When(
  "I switch the notes view to {string}",
  async function (this: KoluWorld, view: string) {
    const btn = this.page.locator(`[data-testid="notes-mode-${view}"]`);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click({ force: true });
    await this.waitForFrame();
  },
);

Then(
  "the notes preview should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (want) => {
        const el = document.querySelector('[data-testid="notes-preview"]');
        return (el?.textContent ?? "").includes(want);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
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
  "the terminal note icon should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(NOTE_ICON)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click the terminal note icon", async function (this: KoluWorld) {
  const icon = this.page.locator(NOTE_ICON).first();
  await icon.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await icon.click({ force: true });
  await this.waitForFrame();
});

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
// handler (reveal the Notes tab) must win, so a markdown link must degrade to
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
    // it's still visible and clickable (the user can add notes even
    // when the terminal isn't in a git repo).
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
