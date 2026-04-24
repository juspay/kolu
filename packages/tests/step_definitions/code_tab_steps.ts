import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

function changedFileSelector(path: string): string {
  return `[data-testid="diff-file-item"][data-path="${path}"]`;
}

async function waitForChangedFile(world: KoluWorld, path: string) {
  const item = world.page.locator(changedFileSelector(path));
  const refresh = world.page.locator('[data-testid="diff-refresh"]');
  const deadline = Date.now() + POLL_TIMEOUT;
  let nextRefresh = Date.now();

  while (Date.now() < deadline) {
    if (await item.isVisible().catch(() => false)) return;

    if (Date.now() >= nextRefresh && (await refresh.isVisible())) {
      await refresh.click().catch(() => undefined);
      nextRefresh = Date.now() + 1000;
    }

    await world.page.waitForTimeout(100);
  }

  await item.waitFor({ state: "visible", timeout: 1 });
}

// ── Actions ──

When("I click the Code tab", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-code"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await this.waitForFrame();
});

When(
  "I click the refresh button in the Code tab",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="diff-refresh"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

When(
  "I click the changed file {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(changedFileSelector(path));
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

When(
  "I click the Code tab mode {string}",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(`[data-testid="diff-mode-${mode}"]`);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

// ── Assertions ──

Then("the Code tab should be active", async function (this: KoluWorld) {
  // The Code tab button exposes data-active reflecting the active
  // tab, which is independent of in-repo vs no-repo content.
  const btn = this.page.locator(
    '[data-testid="right-panel-tab-code"][data-active="true"]',
  );
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the Code tab should indicate no git repository",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="diff-no-repo"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should show the empty-changes message",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="diff-empty"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should list a changed file {string}",
  async function (this: KoluWorld, path: string) {
    await waitForChangedFile(this, path);
  },
);

Then(
  "the Code tab should show a directory node {string}",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(
      `[data-testid="file-tree-dir"][data-path="${path}"]`,
    );
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the directory node {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(
      `[data-testid="file-tree-dir"][data-path="${path}"]`,
    );
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await dir.click();
    await this.waitForFrame();
  },
);

Then(
  "the Code tab should not list a changed file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(changedFileSelector(path));
    await item.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should render a diff view",
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
  "the Code tab should not render a diff view",
  async function (this: KoluWorld) {
    const row = this.page
      .locator('[data-testid="diff-content"] .diff-line[data-state="diff"]')
      .first();
    await row.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(
      `[data-testid="diff-mode-${mode}"][data-active="true"]`,
    );
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// ── File browser actions ──

When(
  "I click the file {string} in the file browser",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `[data-testid="file-browser"] [data-testid="diff-file-item"][data-path="${path}"]`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

When(
  "I click the directory {string} in the file browser",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(
      `[data-testid="file-browser"] [data-testid="file-tree-dir"][data-path="${path}"]`,
    );
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await dir.click();
    await this.waitForFrame();
  },
);

// ── File browser assertions ──

Then(
  "the file browser should show a directory {string}",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(
      `[data-testid="file-browser"] [data-testid="file-tree-dir"][data-path="${path}"]`,
    );
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the file browser should show a file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `[data-testid="file-browser"] [data-testid="diff-file-item"][data-path="${path}"]`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the file content should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp: string) => {
        const el = document.querySelector('[data-testid="file-content"]');
        return el?.textContent?.includes(exp) ?? false;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the Code tab should show a missing-origin error",
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
