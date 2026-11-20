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

const SETTLE_MS = 1800;

let root: string;
const offs: Array<() => void> = [];

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
  vi.stubEnv("GIT_CEILING_DIRECTORIES", path.dirname(root));
});

afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("watchWorkingTree on a root with no working tree", () => {
  it("does not watch a bare repo's folder or the worktrees beside it", async () => {
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
