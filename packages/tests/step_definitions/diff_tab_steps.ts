import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

// ── Actions ──

When("I click the Code Diff tab", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-diff"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await this.waitForFrame();
});

When(
  "I click the refresh button in the Code Diff tab",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="diff-refresh"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

When(
  "I click the changed file {string} in the Code Diff tab",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `[data-testid="diff-file-item"][data-path="${path}"]`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

When("I click the Code Diff tab mode label", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="diff-mode-label"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await this.waitForFrame();
});

// ── Assertions ──

Then("the Code Diff tab should be active", async function (this: KoluWorld) {
  // The Code Diff tab button exposes data-active reflecting the active
  // tab, which is independent of in-repo vs no-repo content.
  const btn = this.page.locator(
    '[data-testid="right-panel-tab-diff"][data-active="true"]',
  );
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the Code Diff tab should indicate no git repository",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="diff-no-repo"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code Diff tab should show the empty-changes message",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="diff-empty"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code Diff tab should list a changed file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `[data-testid="diff-file-item"][data-path="${path}"]`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code Diff tab should render a diff view",
  async function (this: KoluWorld) {
    // Assert an actual rendered diff row, not just the wrapper div —
    // @git-diff-view's wrapper mounts even when it receives zero parseable
    // hunks (it just logs a warning). `.diff-line[data-state="diff"]` is
    // the library's per-row marker inside DiffUnifiedContentLine; at least
    // one must appear when a real diff is parsed.
    const row = this.page
      .locator('[data-testid="diff-content"] .diff-line[data-state="diff"]')
      .first();
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code Diff tab should not render a diff view",
  async function (this: KoluWorld) {
    const row = this.page
      .locator('[data-testid="diff-content"] .diff-line[data-state="diff"]')
      .first();
    await row.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code Diff tab mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    const label = this.page.locator(
      `[data-testid="diff-mode-label"][data-mode="${mode}"]`,
    );
    await label.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code Diff tab should show a missing-origin error",
  async function (this: KoluWorld) {
    const err = this.page.locator('[data-testid="diff-error"]');
    await err.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // The error message must be actionable — if this regex breaks, the
    // user-facing suggestion broke too. See resolveBase() in git-review.ts.
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="diff-error"]');
        const text = el?.textContent ?? "";
        return (
          text.includes("No base branch found") &&
          text.includes("git remote set-head")
        );
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);
