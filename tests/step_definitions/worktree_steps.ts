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
