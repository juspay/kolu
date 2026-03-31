import { When, Then } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { KoluWorld, SIDEBAR_ENTRY_SELECTOR } from "../support/world.ts";
import { readBufferText } from "../support/buffer.ts";
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
  "I set the autolaunch command to {string}",
  async function (this: KoluWorld, command: string) {
    // Use the oRPC HTTP endpoint directly to set autolaunch
    await this.page.request.fetch("/rpc/settings/setAutolaunch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ json: { command: command || null } }),
    });
  },
);

Then(
  "the screen state should not contain {string}",
  async function (this: KoluWorld, unexpected: string) {
    // Wait a bit for any potential autolaunch to execute
    await this.page.waitForTimeout(1000);
    const content = await readBufferText(this.page);
    assert.ok(
      !content.includes(unexpected),
      `Buffer unexpectedly contains "${unexpected}"`,
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
