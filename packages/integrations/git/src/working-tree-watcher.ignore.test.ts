/**
 * The working-tree watcher follows git's ignore RULES, not a snapshot of them.
 *
 * Git reads ignore rules from three places: `.gitignore` files in the tree,
 * `info/exclude` in the common git dir (shared by every worktree), and the
 * global ignore file (`core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore`).
 *
 * The environment points git's global config and XDG config home at temp
 * files, so no case reads or writes the developer's own global ignore file.
 *
 * All cases gate on an event ARRIVING, so they run on linux/inotify only.
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
  quiesce,
  sleep,
  subscribeInstalled,
  waitFor,
} from "./working-tree-watcher.testlib.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

const lines: string[] = [];
const log = {
  info: (_fields: unknown, msg: string) => lines.push(msg),
  error: () => {},
  warn: () => {},
  debug: () => {},
} as unknown as Logger;
const installs = (): number =>
  lines.filter((l) => l === "git: working-tree watcher installed").length;

const SETTLE_MS = 1800;

describe.skipIf(SKIP_DARWIN_FSWATCH)(
  "watchWorkingTree follows git's ignore rules",
  () => {
    let root: string;
    let xdgConfigHome: string;
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
      fs.mkdirSync(path.join(repo, ".waterfall"));
      fs.writeFileSync(path.join(repo, ".waterfall", "plan.md"), "plan\n");
      return repo;
    }

    function writeFile(file: string, content: string): void {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }

    async function watch(repo: string): Promise<{ fired: () => number }> {
      let fired = 0;
      offs.push(await subscribeInstalled(repo, () => fired++, log));
      return { fired: () => fired };
    }

    async function expectUnignoreFollowed(
      repo: string,
      edit: () => void,
    ): Promise<void> {
      const pulses = await watch(repo);
      edit();
      expect(await waitFor(() => pulses.fired() > 0)).toBe(true);

      const before = pulses.fired();
      fs.writeFileSync(path.join(repo, ".waterfall", "notes.md"), "notes\n");
      expect(await waitFor(() => pulses.fired() > before)).toBe(true);
    }

    beforeEach(() => {
      _resetIgnoreRulesWatchers();
      lines.length = 0;
      root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wt-ignore-")),
      );
      xdgConfigHome = path.join(root, "xdg");
      const globalConfig = path.join(root, "gitconfig-global");
      fs.writeFileSync(globalConfig, "");
      vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);
      vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
      vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    });

    afterEach(() => {
      for (const off of offs.splice(0)) off();
      vi.unstubAllEnvs();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("pulses when info/exclude stops ignoring a directory", async () => {
      const repo = initRepo("repo");
      const exclude = path.join(repo, ".git", "info", "exclude");
      writeFile(exclude, ".waterfall/\n");
      const pulses = await watch(repo);

      writeFile(exclude, "");
      expect(await waitFor(() => pulses.fired() > 0)).toBe(true);
    }, 30_000);

    it("watches a directory info/exclude stopped ignoring", async () => {
      const repo = initRepo("repo");
      const exclude = path.join(repo, ".git", "info", "exclude");
      writeFile(exclude, ".waterfall/\n");
      await expectUnignoreFollowed(repo, () => writeFile(exclude, ""));
    }, 30_000);

    it("follows the common dir's info/exclude from a linked worktree", async () => {
      const project = path.join(root, "project");
      const bare = path.join(project, ".git");
      fs.mkdirSync(project);
      git(project, "init", "-q", "--bare", bare);
      const seed = initRepo("seed");
      git(seed, "push", "-q", bare, "main");
      const wt = path.join(project, ".worktrees", "wt");
      git(project, "--git-dir", bare, "worktree", "add", "-q", wt, "main");
      writeFile(path.join(wt, ".waterfall", "plan.md"), "plan\n");
      const exclude = path.join(bare, "info", "exclude");
      writeFile(exclude, ".waterfall/\n");

      await expectUnignoreFollowed(wt, () => writeFile(exclude, ""));
    }, 30_000);

    it("does not rebuild for an exclude edit that changes nothing git ignores", async () => {
      const repo = initRepo("repo");
      const exclude = path.join(repo, ".git", "info", "exclude");
      writeFile(exclude, ".waterfall/\n");
      await watch(repo);
      await sleep(SETTLE_MS);
      const before = installs();

      fs.appendFileSync(exclude, ".waterfall/\nnothing-here/\n");
      await sleep(SETTLE_MS);
      expect(installs()).toBe(before);

      writeFile(exclude, "");
      expect(await waitFor(() => installs() > before)).toBe(true);
      await sleep(SETTLE_MS);
      expect(installs()).toBe(before + 1);
    }, 30_000);

    it("watches a directory a .gitignore edit stopped ignoring", async () => {
      const repo = initRepo("repo");
      writeFile(path.join(repo, ".gitignore"), "dist/\n");
      writeFile(path.join(repo, "dist", "out.js"), "1\n");
      const pulses = await watch(repo);
      const before = installs();

      writeFile(path.join(repo, ".gitignore"), "");
      await waitFor(() => installs() > before);
      await quiesce(pulses.fired);

      const pulsed = pulses.fired();
      writeFile(path.join(repo, "dist", "new.js"), "2\n");
      expect(await waitFor(() => pulses.fired() > pulsed)).toBe(true);
    }, 30_000);

    it("follows the file core.excludesFile names", async () => {
      const repo = initRepo("repo");
      const globalIgnore = path.join(root, "elsewhere", "my-ignores");
      writeFile(globalIgnore, ".waterfall/\n");
      git(repo, "config", "core.excludesFile", globalIgnore);

      await expectUnignoreFollowed(repo, () => writeFile(globalIgnore, ""));
    }, 30_000);

    it("follows $XDG_CONFIG_HOME/git/ignore when core.excludesFile is unset", async () => {
      const repo = initRepo("repo");
      const globalIgnore = path.join(xdgConfigHome, "git", "ignore");
      writeFile(globalIgnore, ".waterfall/\n");

      await expectUnignoreFollowed(repo, () => writeFile(globalIgnore, ""));
    }, 30_000);

    it("follows a global ignore symlink re-pointed at different rules", async () => {
      // The home-manager layout: `core.excludesFile` is a symlink into a store
      // directory that never changes; activation swaps the link.
      const repo = initRepo("repo");
      const storeA = path.join(root, "store-a", "ignore");
      const storeB = path.join(root, "store-b", "ignore");
      writeFile(storeA, ".waterfall/\n");
      writeFile(storeB, "");
      const link = path.join(root, "home", "git", "ignore");
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(storeA, link);
      git(repo, "config", "core.excludesFile", link);

      await expectUnignoreFollowed(repo, () => {
        const next = `${link}.next`;
        fs.symlinkSync(storeB, next);
        fs.renameSync(next, link);
      });
    }, 30_000);
  },
);
