import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";

When(
  "I set up a git repo at {string}",
  async function (this: KoluWorld, repoPath: string) {
    // Clean slate — remove then reinit. The worktree scenario creates
    // subdirs like .worktrees/ that git init --force wouldn't clean.
    execFileSync("bash", [
      "-c",
      `rm -rf "${repoPath}" && git init "${repoPath}"`,
    ]);
    execFileSync("git", [
      "-C",
      repoPath,
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ]);
    // Set up a fake origin so `git fetch origin` works
    execFileSync("git", ["-C", repoPath, "remote", "add", "origin", repoPath]);
    execFileSync("git", ["-C", repoPath, "fetch", "origin"]);
  },
);

Then(
  "the new worktree dialog should be visible",
  async function (this: KoluWorld) {
    const dialog = this.page.locator('[data-testid="new-worktree-dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the worktree dialog should show repo {string}",
  async function (this: KoluWorld, repoName: string) {
    const dialog = this.page.locator('[data-testid="new-worktree-dialog"]');
    const item = dialog
      .locator('[data-testid="worktree-repo-item"]')
      .filter({ hasText: new RegExp(`^${repoName}`) });
    await item.first().waitFor({ state: "visible", timeout: 3000 });
  },
);

When(
  "I select repo {string} in the worktree dialog",
  async function (this: KoluWorld, repoName: string) {
    const dialog = this.page.locator('[data-testid="new-worktree-dialog"]');
    const item = dialog
      .locator('[data-testid="worktree-repo-item"]')
      .filter({ hasText: new RegExp(`^${repoName}`) });
    await item.first().waitFor({ state: "visible", timeout: 3000 });
    await item.first().click();
    await this.waitForFrame();
  },
);

When(
  "I select agent {string} in the worktree dialog",
  async function (this: KoluWorld, agentLabel: string) {
    const dialog = this.page.locator('[data-testid="new-worktree-dialog"]');
    const agentBtn = dialog.locator("button").filter({ hasText: agentLabel });
    await agentBtn.first().click();
    await this.waitForFrame();
  },
);

When("I click the worktree create button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="worktree-create-btn"]');
  await this.waitForFrame();
  // Wait for worktree creation + terminal spawn
  await this.page.waitForTimeout(1000);
});

Then(
  "the sidebar should have {int} fewer terminal entry/entries",
  async function (this: KoluWorld, fewer: number) {
    assert.ok(
      this.savedSidebarCount !== undefined,
      "Must note sidebar count first",
    );
    const expected = this.savedSidebarCount! - fewer;
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    for (let attempt = 0; attempt < 20; attempt++) {
      const count = await entries.count();
      if (count === expected) return;
      await this.waitForFrame();
    }
    const count = await entries.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} sidebar entries (${this.savedSidebarCount} - ${fewer}), got ${count}`,
    );
  },
);
