import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import {
  KoluWorld,
  PILL_TREE_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";
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

When(
  "I set up a bare git repo at {string}",
  async function (this: KoluWorld, repoPath: string) {
    execFileSync("bash", [
      "-c",
      `rm -rf "${repoPath}" && git init --bare "${repoPath}"`,
    ]);
  },
);

When(
  "I add a git worktree at {string} in repo {string} on branch {string}",
  async function (
    this: KoluWorld,
    worktreePath: string,
    repoPath: string,
    branch: string,
  ) {
    execFileSync("bash", ["-c", `rm -rf "${worktreePath}"`]);
    execFileSync("git", [
      "-C",
      repoPath,
      "worktree",
      "add",
      worktreePath,
      "-b",
      branch,
    ]);
  },
);

Then(
  "the close confirmation should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="close-confirm"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the close confirmation should not be visible",
  async function (this: KoluWorld) {
    // Give the dialog a moment to appear if it's going to — then assert hidden.
    await this.page.waitForTimeout(300);
    const confirm = this.page.locator('[data-testid="close-confirm"]');
    assert.strictEqual(
      await confirm.isVisible(),
      false,
      "Expected close confirmation dialog to not be visible",
    );
  },
);

When(
  "I confirm close all in the close confirmation",
  async function (this: KoluWorld) {
    await this.page.locator('[data-testid="close-confirm-close-all"]').click();
  },
);

When("I confirm worktree removal", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="close-confirm-remove"]').click();
});

Then(
  "the close confirmation should not offer worktree removal",
  async function (this: KoluWorld) {
    // The dialog must be visible first — assert the remove button is absent
    // while the dialog itself is open, so we don't accidentally pass because
    // the whole dialog hasn't rendered yet.
    await this.page
      .locator('[data-testid="close-confirm"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const remove = this.page.locator('[data-testid="close-confirm-remove"]');
    assert.strictEqual(
      await remove.count(),
      0,
      "Expected 'Remove worktree' button to be absent when another terminal shares the worktree",
    );
    await this.page
      .locator('[data-testid="close-confirm-shared-note"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click close only in the close confirmation",
  async function (this: KoluWorld) {
    await this.page.locator('[data-testid="close-confirm-close-only"]').click();
  },
);

When("I dismiss the close confirmation", async function (this: KoluWorld) {
  // Press Escape to close the dialog
  await this.page.keyboard.press("Escape");
  await this.page
    .locator('[data-testid="close-confirm"]')
    .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

When("I cancel the close confirmation", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="close-confirm-cancel"]').click();
  await this.page
    .locator('[data-testid="close-confirm"]')
    .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "the pill tree entry count should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.savedPillTreeCount !== undefined,
      "Must note pill tree count first",
    );
    const current = await this.page.locator(PILL_TREE_ENTRY_SELECTOR).count();
    assert.strictEqual(
      current,
      this.savedPillTreeCount,
      `Expected pill tree count unchanged at ${this.savedPillTreeCount}, got ${current}`,
    );
  },
);

Then(
  "the pill tree should have {int} fewer terminal entry/entries",
  async function (this: KoluWorld, fewer: number) {
    assert.ok(
      this.savedPillTreeCount !== undefined,
      "Must note pill tree count first",
    );
    const expected = this.savedPillTreeCount! - fewer;
    const sel = PILL_TREE_ENTRY_SELECTOR;
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);
