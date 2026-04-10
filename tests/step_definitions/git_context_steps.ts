import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

/** Wait for a data-testid element's text to include the given substring. */
async function waitForTestIdText(
  world: KoluWorld,
  testId: string,
  includes?: string,
): Promise<void> {
  await world.page.waitForFunction(
    ({ testId, includes }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      const text = el?.textContent ?? "";
      return includes ? text.includes(includes) : text.length > 0;
    },
    { testId, includes },
    { timeout: POLL_TIMEOUT },
  );
}

When(
  "the branch is switched to {string} in {string}",
  async function (this: KoluWorld, branch: string, repoPath: string) {
    // Switch branch externally (not through the terminal), bypassing OSC 7.
    // This exercises the .git/HEAD file watcher path.
    execFileSync("git", ["checkout", "-b", branch], { cwd: repoPath });
  },
);

Then("the header should show a branch name", async function (this: KoluWorld) {
  await waitForTestIdText(this, "header-branch");
});

Then(
  "the header branch should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForTestIdText(this, "header-branch", expected);
  },
);

Then(
  "the sidebar branch should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForTestIdText(this, "terminal-meta-branch", expected);
  },
);

Then("the sidebar should show a branch name", async function (this: KoluWorld) {
  await waitForTestIdText(this, "terminal-meta-branch");
});

Then(
  "the header should not show git context",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="header-branch"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no git context in header but found ${count} branch elements`,
    );
  },
);

Then(
  "the sidebar label should show {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForTestIdText(this, "terminal-meta-name", expected);
  },
);

Then(
  "the sidebar should show a worktree indicator",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="worktree-indicator"]')
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the sidebar should not show a worktree indicator",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="worktree-indicator"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no worktree indicator but found ${count}`,
    );
  },
);

Then("the sidebar should not show PR info", async function (this: KoluWorld) {
  const count = await this.page
    .locator('[data-testid="terminal-meta-pr"]')
    .count();
  assert.strictEqual(
    count,
    0,
    `Expected no PR info in sidebar but found ${count} PR elements`,
  );
});

Then(
  "the sidebar should not show git context",
  async function (this: KoluWorld) {
    const text = (
      await this.page
        .locator('[data-testid="terminal-meta-branch"]')
        .first()
        .textContent()
    )?.trim();
    assert.strictEqual(
      text ?? "",
      "",
      `Expected empty branch in sidebar but found "${text}"`,
    );
  },
);
