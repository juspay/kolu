import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import {
  KoluWorld,
  SIDEBAR_ENTRY_SELECTOR,
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

Then(
  "the new worktree dialog should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="new-worktree-dialog"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // Wait until the branch name suggestion has arrived from the server
    // so the dialog is fully seeded before interaction.
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector<HTMLInputElement>(
          '[data-testid="new-worktree-branch"]',
        );
        return el !== null && el.value.length > 0;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I set the new worktree branch name to {string}",
  async function (this: KoluWorld, name: string) {
    const input = this.page.locator('[data-testid="new-worktree-branch"]');
    await input.fill(name);
  },
);

When(
  "I set the new worktree auto-run command to {string}",
  async function (this: KoluWorld, cmd: string) {
    const input = this.page.locator('[data-testid="new-worktree-autorun"]');
    await input.fill(cmd);
  },
);

When("I submit the new worktree dialog", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="new-worktree-create"]').click();
  await this.page
    .locator('[data-testid="new-worktree-dialog"]')
    .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "the close confirmation should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="close-confirm"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
      { timeout: POLL_TIMEOUT },
    );
  },
);
