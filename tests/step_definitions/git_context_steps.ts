import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";
import { pollUntil } from "../support/poll.ts";

/** Poll a data-testid element until its text satisfies a predicate. */
async function pollTestId(
  world: KoluWorld,
  testId: string,
  predicate: (text: string) => boolean,
): Promise<string> {
  const el = world.page.locator(`[data-testid="${testId}"]`);
  return pollUntil(
    world.page,
    async () => {
      try {
        return (await el.textContent({ timeout: 1000 })) ?? "";
      } catch {
        return "";
      }
    },
    predicate,
    { attempts: 40, intervalMs: 200 },
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
  const text = await pollTestId(this, "header-branch", (t) => t.length > 0);
  assert.ok(text.length > 0, `Expected header to show a branch name`);
});

Then(
  "the header branch should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const text = await pollTestId(this, "header-branch", (t) =>
      t.includes(expected),
    );
    assert.ok(
      text.includes(expected),
      `Expected header branch to contain "${expected}", got "${text}"`,
    );
  },
);

Then(
  "the sidebar branch should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const text = await pollTestId(this, "terminal-meta-branch", (t) =>
      t.includes(expected),
    );
    assert.ok(
      text.includes(expected),
      `Expected sidebar branch to contain "${expected}", got "${text}"`,
    );
  },
);

Then("the sidebar should show a branch name", async function (this: KoluWorld) {
  const text = await pollTestId(
    this,
    "terminal-meta-branch",
    (t) => t.length > 0,
  );
  assert.ok(text.length > 0, `Expected sidebar to show a branch name`);
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
    const text = await pollTestId(this, "terminal-meta-name", (t) =>
      t.includes(expected),
    );
    assert.ok(
      text.includes(expected),
      `Expected sidebar label to contain "${expected}", got "${text}"`,
    );
  },
);

Then(
  "the sidebar should show a worktree indicator",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="worktree-indicator"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 });
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
  // Wait a beat for any async PR resolution to settle
  await this.page.waitForTimeout(2000);
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
