/**
 * The working-tree watcher watches a working tree or nothing.
 *
 * A bare repo's folder has no working tree, and in the `~/code/kolu` layout it
 * holds every linked worktree of the repo under `.worktrees/` — watching it
 * walks all of them. A folder git cannot answer for is not watched either, and
 * a repo whose ignored paths git cannot list is not watched with a guessed
 * ignore set: it is watched once git can list them again.
 *
 * The first two cases assert that nothing is installed, so they cannot use
 * `subscribeInstalled` (it waits for a reconcile tick that must never come);
 * they poll the watcher's own log lines instead. The environment points git's
 * global config and XDG config home at temp files, as the ignore suite does.
 * Waits are real time: the watcher answers real filesystem events and git
 * subprocesses, which fake timers cannot drive.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIP_DARWIN_FSWATCH } from "./fs-watch-delivery.testlib.ts";
import { _resetIgnoreRulesWatchers } from "./ignore-rules-watcher.ts";
import {
  _sharedWorkingTreeWatcherCount,
  listWorkingTreeWatcherRows,
  watchWorkingTree,
} from "./working-tree-watcher.ts";
import { quiesce, sleep, waitFor } from "./working-tree-watcher.testlib.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Every `info` / `warn` / `error` line the watcher logs, as `level message`. */
const lines: string[] = [];
const log = {
  info: (_fields: unknown, msg: string) => lines.push(`info ${msg}`),
  warn: (_fields: unknown, msg: string) => lines.push(`warn ${msg}`),
  error: (_fields: unknown, msg: string) => lines.push(`error ${msg}`),
  debug: () => {},
} as unknown as Logger;
const logged = (line: string): boolean => lines.includes(line);

const NO_WORK_TREE =
  "info git: working-tree watcher not installed, no working tree";
const INSTALL_FAILED = "error git: working-tree watcher install failed";
const INSTALLED = "info git: working-tree watcher installed";

/** Longer than the ignore-rule dir watchers' 1s stat poll plus every debounce
 *  in the chain — enough for anything a write could trigger to have run. */
const SETTLE_MS = 1800;

let root: string;
const offs: Array<() => void> = [];

/** A committed repo at `root/<name>`. */
function initRepo(name: string): string {
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "a@b.c");
  git(repo, "config", "user.name", "a");
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "1\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  return repo;
}

/** Subscribe, counting every pulse the listener receives. */
function watch(dir: string): { fired: () => number } {
  let fired = 0;
  offs.push(watchWorkingTree(dir, "test", () => fired++, log));
  return { fired: () => fired };
}

beforeEach(() => {
  _resetIgnoreRulesWatchers();
  lines.length = 0;
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-no-work-tree-")),
  );
  const globalConfig = path.join(root, "gitconfig-global");
  fs.writeFileSync(globalConfig, "");
  vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "xdg"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  // Keep git from finding a repo above the temp root.
  vi.stubEnv("GIT_CEILING_DIRECTORIES", path.dirname(root));
});

afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("watchWorkingTree on a root with no working tree", () => {
  it("does not watch a bare repo's folder or the worktrees beside it", async () => {
    // The `~/code/kolu` layout: a bare `.git` and a linked worktree under
    // `.worktrees/`, all in one folder.
    const project = path.join(root, "project");
    const bare = path.join(project, ".git");
    fs.mkdirSync(project);
    git(project, "init", "-q", "--bare", bare);
    const seed = initRepo("seed");
    git(seed, "push", "-q", bare, "main");
    const wt = path.join(project, ".worktrees", "wt");
    git(project, "--git-dir", bare, "worktree", "add", "-q", wt, "main");

    const before = _sharedWorkingTreeWatcherCount();
    const pulses = watch(project);
    expect(await waitFor(() => logged(NO_WORK_TREE))).toBe(true);

    // A save inside the worktree, and a non-empty directory — what made the
    // old watch walk the whole folder again.
    fs.writeFileSync(path.join(wt, "src", "app.ts"), "2\n");
    fs.mkdirSync(path.join(wt, "build", "out"), { recursive: true });
    fs.writeFileSync(path.join(wt, "build", "out", "a.js"), "1\n");
    await sleep(SETTLE_MS);

    expect(pulses.fired()).toBe(0);
    expect(logged(INSTALLED)).toBe(false);
    expect(lines.filter((l) => l.includes("rebuilding"))).toEqual([]);
    expect(
      lines.filter((l) => l.startsWith("warn") || l.startsWith("error")),
    ).toEqual([]);

    // Its diagnostic row says why nothing is installed, and claims no
    // install time or ignore count it never measured.
    const row = listWorkingTreeWatcherRows().find(
      (r) => r.repoRoot === project,
    );
    expect(row?.state).toEqual({ kind: "no-working-tree" });
    expect(row?.askers).toEqual(["test"]);
    expect(row?.lastInstallMs.kind).toBe("unmeasured");
    expect(row?.ignoredPaths.kind).toBe("unmeasured");

    expect(_sharedWorkingTreeWatcherCount()).toBe(before + 1);
    for (const off of offs.splice(0)) off();
    expect(_sharedWorkingTreeWatcherCount()).toBe(before);
  }, 30_000);

  it("does not watch a folder git cannot answer for", async () => {
    const dir = path.join(root, "plain");
    fs.mkdirSync(dir);
    const pulses = watch(dir);
    expect(await waitFor(() => logged(INSTALL_FAILED))).toBe(true);

    fs.writeFileSync(path.join(dir, "notes.md"), "notes\n");
    await sleep(SETTLE_MS);

    expect(pulses.fired()).toBe(0);
    expect(logged(INSTALLED)).toBe(false);
    expect(
      listWorkingTreeWatcherRows().find((r) => r.repoRoot === dir)?.state.kind,
    ).toBe("failed");
  }, 30_000);
});

describe.skipIf(SKIP_DARWIN_FSWATCH)(
  "watchWorkingTree on a repo git cannot list",
  () => {
    it("watches the repo once git can list its ignored paths again", async () => {
      const repo = initRepo("repo");
      // A working tree git still recognizes, whose index it cannot read:
      // `git ls-files` fails while `rev-parse` answers.
      fs.writeFileSync(path.join(repo, ".git", "index"), "garbage");

      const pulses = watch(repo);
      expect(await waitFor(() => logged(INSTALL_FAILED))).toBe(true);
      expect(logged(INSTALLED)).toBe(false);

      git(repo, "read-tree", "HEAD");
      fs.appendFileSync(
        path.join(repo, ".git", "info", "exclude"),
        "nothing-here/\n",
      );
      expect(await waitFor(() => logged(INSTALLED))).toBe(true);
      await quiesce(pulses.fired);

      const before = pulses.fired();
      fs.writeFileSync(path.join(repo, "src", "app.ts"), "2\n");
      expect(await waitFor(() => pulses.fired() > before)).toBe(true);
    }, 30_000);
  },
);
