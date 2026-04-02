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
  "the worktree remove confirmation should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="worktree-remove-confirm"]')
      .waitFor({ state: "visible", timeout: 5000 });
  },
);

When("I confirm worktree removal", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="worktree-confirm-remove"]').click();
});

When(
  "I click close only in the worktree confirmation",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="worktree-confirm-close-only"]')
      .click();
  },
);

When(
  "I dismiss the worktree remove confirmation",
  async function (this: KoluWorld) {
    // Press Escape to close the dialog
    await this.page.keyboard.press("Escape");
    await this.page
      .locator('[data-testid="worktree-remove-confirm"]')
      .waitFor({ state: "hidden", timeout: 5000 });
  },
);

Then(
  "the sidebar entry count should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.savedSidebarCount !== undefined,
      "Must note sidebar count first",
    );
    const current = await this.page.locator(SIDEBAR_ENTRY_SELECTOR).count();
    assert.strictEqual(
      current,
      this.savedSidebarCount,
      `Expected sidebar count unchanged at ${this.savedSidebarCount}, got ${current}`,
    );
  },
);

Then(
  "the sidebar should have {int} fewer terminal entry/entries",
  async function (this: KoluWorld, fewer: number) {
    assert.ok(
      this.savedSidebarCount !== undefined,
      "Must note sidebar count first",
    );
    const expected = this.savedSidebarCount! - fewer;
    const sel = SIDEBAR_ENTRY_SELECTOR;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: 5000 },
    );
  },
);
