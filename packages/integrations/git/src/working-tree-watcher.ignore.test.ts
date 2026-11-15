/**
 * The working-tree watcher follows git's ignore RULES, not a snapshot of them.
 *
 * Git reads ignore rules from three places: `.gitignore` files in the tree,
 * `info/exclude` in the common git dir (shared by every worktree), and the
 * global ignore file (`core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore`).
 * When any of them un-ignores a directory, the Code tab must hear about it —
 * its tracked and ignored listings re-read together — and the directory must
 * join the watch, so a write inside it pulses too.
 *
 * Every case drives `watchWorkingTree` and waits on its listener, the way the
 * Code tab does. The environment points git's global config and XDG config
 * home at temp files, so no case reads or writes the developer's own global
 * ignore file — and the developer's own settings cannot shadow these.
 *
 * All cases gate on an event ARRIVING, so they run on linux/inotify only — see
 * `SKIP_DARWIN_FSWATCH`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKIP_DARWIN_FSWATCH } from "./fs-watch-delivery.testlib.ts";
import { _resetIgnoreRulesWatchers } from "./ignore-rules-watcher.ts";
import { subscribeInstalled } from "./working-tree-watcher.testlib.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `cond` until it holds or `ms` elapses; answers whether it held. */
async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 50) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Captured `log.info` messages, so a case can count watcher installs. */
const lines: string[] = [];
const log = {
  info: (_fields: unknown, msg: string) => lines.push(msg),
  error: () => {},
  warn: () => {},
  debug: () => {},
} as unknown as Logger;
const installs = (): number =>
  lines.filter((l) => l === "git: working-tree watcher installed").length;

/** Longer than the ignore-rule dir watchers' 1s stat poll plus every debounce
 *  in the chain — enough for any refresh an edit could trigger to have run. */
const SETTLE_MS = 1800;

describe.skipIf(SKIP_DARWIN_FSWATCH)(
  "watchWorkingTree follows git's ignore rules",
  () => {
    let root: string;
    let xdgConfigHome: string;
    const offs: Array<() => void> = [];

    /** A committed repo at `root/<name>` holding an untracked `.waterfall/`. */
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

    /** Subscribe, counting every pulse after the install's own tick. */
    async function watch(repo: string): Promise<{ fired: () => number }> {
      let fired = 0;
      offs.push(await subscribeInstalled(repo, () => fired++, log));
      return { fired: () => fired };
    }

    /** The reported bug, from any rule file: with `.waterfall/` ignored by
     *  `ruleFile`, rewriting that file without the line must pulse the
     *  listener, and a write inside `.waterfall/` afterwards must pulse too. */
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
      // The `~/code/kolu` layout: a bare `.git` and linked worktrees, all
      // reading ONE `info/exclude`.
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
      // Let the rule watchers' own attach ticks run their refresh.
      await sleep(SETTLE_MS);
      const before = installs();

      // A duplicate line and a rule matching nothing — what agents append to
      // the shared exclude file all day.
      fs.appendFileSync(exclude, ".waterfall/\nnothing-here/\n");
      await sleep(SETTLE_MS);
      expect(installs()).toBe(before);

      // The watcher was listening all along: a real change rebuilds, once.
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

      // The `.gitignore` write pulses on its own — it is a working-tree file.
      // What it must ALSO do is bring `dist/` into the watch.
      writeFile(path.join(repo, ".gitignore"), "");
      await waitFor(() => installs() > before);
      await sleep(300);

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
      // The home-manager layout: the configured path is a symlink into a
      // store directory that never changes; activation swaps the link.
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
