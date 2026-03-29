import { When, Then, Given } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";

const WORKTREE_DIALOG_SELECTOR = '[data-testid="worktree-dialog"]';

When(
  "I set up a git repo at {string}",
  async function (this: KoluWorld, repoPath: string) {
    // Create a bare-minimum repo with an initial commit and a remote
    execFileSync("rm", ["-rf", repoPath]);
    execFileSync("git", ["init", repoPath]);
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

When(
  "I create a worktree {string} in {string}",
  async function (this: KoluWorld, branch: string, repoPath: string) {
    const wtPath = `${repoPath}/.worktrees/${branch}`;
    execFileSync("git", [
      "-C",
      repoPath,
      "worktree",
      "add",
      "-b",
      branch,
      wtPath,
    ]);
  },
);

Then("the worktree dialog should be visible", async function (this: KoluWorld) {
  const dialog = this.page.locator(WORKTREE_DIALOG_SELECTOR);
  await dialog.waitFor({ state: "visible", timeout: 3000 });
});

When(
  "I type {string} in the worktree dialog",
  async function (this: KoluWorld, text: string) {
    const input = this.page.locator(`${WORKTREE_DIALOG_SELECTOR} input`);
    await input.waitFor({ state: "visible", timeout: 3000 });
    await input.fill(text);
    await this.page.waitForTimeout(200);
  },
);

When("I submit the worktree dialog", async function (this: KoluWorld) {
  const submit = this.page.locator(
    `${WORKTREE_DIALOG_SELECTOR} button[type="submit"]`,
  );
  await submit.click();
  // Wait for dialog to close and terminal to appear
  const dialog = this.page.locator(WORKTREE_DIALOG_SELECTOR);
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  await this.page.waitForTimeout(500);
});

Given("I note the sidebar entry count", async function (this: KoluWorld) {
  const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
  this.savedSidebarCount = await entries.count();
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
      await this.page.waitForTimeout(300);
    }
    const count = await entries.count();
    assert.strictEqual(
      count,
      expected,
      `Expected ${expected} sidebar entries (${this.savedSidebarCount} - ${fewer}), got ${count}`,
    );
  },
);

Then(
  "the worktree {string} should not exist",
  async function (_this: KoluWorld, wtPath: string) {
    // Poll briefly — removal may be async
    for (let i = 0; i < 10; i++) {
      if (!existsSync(wtPath)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(!existsSync(wtPath), `Worktree still exists at ${wtPath}`);
  },
);
