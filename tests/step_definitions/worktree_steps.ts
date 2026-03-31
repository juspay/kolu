import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import * as assert from "node:assert";

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
