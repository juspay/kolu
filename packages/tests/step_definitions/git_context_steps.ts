import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const ACTIVE_TITLE_BRANCH_SELECTOR =
  '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]';

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

When(
  "a git repo is initialized externally in {string}",
  async function (this: KoluWorld, repoPath: string) {
    // Run `git init` from the test process, not the terminal's shell —
    // no OSC 7 fires, so the provider only has the cwd-entry watcher to
    // notice `.git`. Mirrors the user's bug in #813.
    execFileSync("git", ["init", repoPath], { stdio: "ignore" });
    // Belt-and-braces: the cwd-entry `fs.watch` can drop the single
    // `.git` create event under 4-worker parallel-test load (Linux
    // inotify queue overflow). Press Enter at the shell to drive a
    // fresh OSC 7; the cwd-channel publish triggers `setCwd(samePath)`
    // in `subscribeGitInfo`, which has a built-in re-resolve when
    // `currentInfo === null && hasGitDir(next)` — the resolve sees the
    // newly-created `.git` and emits the GitInfo even when the watcher
    // event was lost. Test-side recovery only; no app behaviour change.
    await this.page.keyboard.press("Enter");
  },
);

Then("the header should show a branch name", async function (this: KoluWorld) {
  await waitForTestIdText(this, "inspector-branch");
});

Then(
  "the header branch should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForTestIdText(this, "inspector-branch", expected);
  },
);

Then(
  "the workspace switcher branch should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForTestIdText(this, "terminal-meta-branch", expected);
  },
);

When("I click the terminal title branch", async function (this: KoluWorld) {
  const branch = this.page.locator(ACTIVE_TITLE_BRANCH_SELECTOR);
  await branch.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await branch.click();
});

When(
  "I double-click the terminal title branch",
  async function (this: KoluWorld) {
    const branch = this.page.locator(ACTIVE_TITLE_BRANCH_SELECTOR);
    await branch.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await branch.evaluate((el) => {
      el.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    await this.waitForFrame();
  },
);

Then(
  "the workspace switcher should show a branch name",
  async function (this: KoluWorld) {
    await waitForTestIdText(this, "terminal-meta-branch");
  },
);

Then(
  "the header should not show git context",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="inspector-branch"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no git context in header but found ${count} branch elements`,
    );
  },
);

Then(
  "the workspace switcher label should show {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForTestIdText(this, "terminal-meta-name", expected);
  },
);

Then(
  "the workspace switcher should show a worktree indicator",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="worktree-indicator"]')
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the workspace switcher should not show a worktree indicator",
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

Then(
  "the workspace switcher should not show PR info",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="terminal-meta-pr"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no PR info in workspace switcher but found ${count} PR elements`,
    );
  },
);

Then(
  "the workspace switcher should not show git context",
  async function (this: KoluWorld) {
    // Under the supplant rule the title-bar annotation slot shows the
    // intent line-1 if set, else the branch, else an em-dash placeholder.
    // "No git context" means no branch — the slot is either empty (old
    // behavior, no longer reachable on non-git terminals) or shows the
    // placeholder. Poll until the reactive update settles.
    await this.page.waitForFunction(
      () => {
        const text = (
          document.querySelector('[data-testid="terminal-meta-branch"]')
            ?.textContent ?? ""
        ).trim();
        return text === "" || text === "—";
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
