import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

// Selectors mirror `commentsTestIds` exported from
// `packages/client/src/right-panel/CommentsTray.tsx` and
// `composerTestIds` from `CommentComposer.tsx`. Cross-package imports
// from `tests` into `client` aren't wired (and shouldn't be — the
// tests treat the rendered DOM as the contract). If the strings drift,
// e2e fails loudly here.
const TRAY = '[data-testid="comments-tray"]';
const TOGGLE = '[data-testid="comment-mode-toggle"]';
const COPY_BTN = '[data-testid="comments-copy"]';
const ITEM = '[data-testid="comments-item"]';
const EDIT_BTN = '[data-testid="comments-edit"]';
const POPOVER = '[data-testid="inline-comment-popover"]';
const POPOVER_TEXTAREA = '[data-testid="comment-composer-textarea"]';
const ADD_BUBBLE = '[data-testid="inline-add-bubble"]';
const COMMENT_BUBBLE = '[data-testid="inline-comment-bubble"]';

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
  "I type {string} into the inline comment composer",
  async function (this: KoluWorld, text: string) {
    const ta = this.page.locator(POPOVER_TEXTAREA);
    await ta.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // `fill` replaces existing content — works for both new (empty)
    // and edit (prefilled) flows.
    await ta.fill(text);
    await this.waitForFrame();
  },
);

When(
  "I press Enter to submit the inline comment",
  async function (this: KoluWorld) {
    const ta = this.page.locator(POPOVER_TEXTAREA);
    await ta.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // Plain Enter (no modifier) submits — Shift+Enter would just add a
    // newline. `press("Enter")` mirrors what a user types.
    await ta.press("Enter");
    await this.waitForFrame();
  },
);

When(
  "I click the edit pencil on comment {int}",
  async function (this: KoluWorld, oneBasedIndex: number) {
    // Locator-by-index is 0-based; the feature reads 1-based for
    // natural language ("comment 1").
    const btn = this.page
      .locator(ITEM)
      .nth(oneBasedIndex - 1)
      .locator(EDIT_BTN);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

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
  "the inline comment popover should be visible",
  async function (this: KoluWorld) {
    const pop = this.page.locator(POPOVER);
    await pop.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the inline add-comment bubble should be visible",
  async function (this: KoluWorld) {
    const bubble = this.page.locator(ADD_BUBBLE);
    await bubble.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click the inline add-comment bubble", async function (this: KoluWorld) {
  const bubble = this.page.locator(ADD_BUBBLE);
  await bubble.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await bubble.click();
  await this.waitForFrame();
});

When(
  "I click the inline existing-comment bubble",
  async function (this: KoluWorld) {
    const bubble = this.page.locator(COMMENT_BUBBLE).first();
    await bubble.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await bubble.click();
    await this.waitForFrame();
  },
);

When("I disable comment mode", async function (this: KoluWorld) {
  const btn = this.page.locator(TOGGLE);
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const pressed = await btn.getAttribute("aria-pressed");
  if (pressed === "true") {
    await btn.click();
    await this.waitForFrame();
  }
});

Then(
  "the inline existing-comment bubble should be visible",
  async function (this: KoluWorld) {
    const bubble = this.page.locator(COMMENT_BUBBLE).first();
    await bubble.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the inline add-comment bubble should not be visible",
  async function (this: KoluWorld) {
    // `<Show>` removes the node from the tree when `pos()` is null;
    // wait for full detachment rather than just `hidden` so a stale
    // mid-transition node doesn't pass the assertion.
    const bubble = this.page.locator(ADD_BUBBLE);
    await bubble.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

async function assertCommentCount(world: KoluWorld, expected: number) {
  await world.page.waitForFunction(
    (n) =>
      document.querySelectorAll('[data-testid="comments-item"]').length === n,
    expected,
    { timeout: POLL_TIMEOUT },
  );
}

// One step handler for both singular and plural so the feature reads
// naturally ("0 comments", "1 comment", "3 comments") without two
// byte-identical Then bodies drifting from each other.
Then(
  "the comments tray should list {int} comment",
  async function (this: KoluWorld, n: number) {
    await assertCommentCount(this, n);
  },
);

Then(
  "the comments tray should list {int} comments",
  async function (this: KoluWorld, n: number) {
    await assertCommentCount(this, n);
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
