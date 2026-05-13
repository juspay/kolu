import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TRAY = '[data-testid="comments-tray"]';
const TOGGLE = '[data-testid="comment-mode-toggle"]';
const COMPOSER = '[data-testid="comments-composer"]';
const ADD_BTN = '[data-testid="comments-add"]';
const COPY_BTN = '[data-testid="comments-copy"]';
const ITEM = '[data-testid="comments-item"]';

// ── Actions ──

When("I enable comment mode", async function (this: KoluWorld) {
  const btn = this.page.locator(TOGGLE);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const pressed = await btn.getAttribute("aria-pressed");
  if (pressed !== "true") {
    await btn.click();
    await this.waitForFrame();
  }
});

When(
  "I type {string} into the comment composer",
  async function (this: KoluWorld, text: string) {
    const composer = this.page.locator(COMPOSER);
    await composer.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await composer.fill(text);
    await this.waitForFrame();
  },
);

When("I click the Add-comment button", async function (this: KoluWorld) {
  const btn = this.page.locator(ADD_BTN);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await this.waitForFrame();
});

When("I click the Copy-to-clipboard button", async function (this: KoluWorld) {
  const btn = this.page.locator(COPY_BTN);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  // Force-enable clipboard-write so navigator.clipboard.writeText is
  // available in the test browser without a real user gesture chain.
  await this.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await btn.click();
  await this.waitForFrame();
});

// ── Assertions ──

Then("the comments tray should be visible", async function (this: KoluWorld) {
  const tray = this.page.locator(TRAY);
  await tray.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the comments tray should be hidden", async function (this: KoluWorld) {
  const tray = this.page.locator(TRAY);
  await tray.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
});

Then(
  "the comments tray should list {int} comment",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="comments-item"]').length === n,
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the comments tray should list {int} comments",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="comments-item"]').length === n,
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the clipboard text should match the kolu-comments-v1 envelope",
  async function (this: KoluWorld) {
    // Poll: the clipboard write is async, and on slower runners the
    // read can outrun it. waitForFunction retries until the condition
    // holds or POLL_TIMEOUT expires.
    await this.page.waitForFunction(
      () =>
        navigator.clipboard
          .readText()
          .then((t) => t.startsWith("[kolu comments v1]\n")),
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the clipboard text should contain {string}",
  async function (this: KoluWorld, needle: string) {
    await this.page.waitForFunction(
      (n) => navigator.clipboard.readText().then((t) => t.includes(n)),
      needle,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Suppress unused-import lint when item selector is reused locally.
void ITEM;
