import fs from "node:fs";
import path from "node:path";
import type { WatchAsker } from "kolu-io";
import type { Logger } from "kolu-shared";
import type { SimpleGit } from "simple-git";
import { backgroundGit } from "./background.ts";
import { watchGitConfig } from "./config-watcher.ts";
import { watchCwdForGitDir } from "./cwd-git-watcher.ts";
import { err, type GitResult, ok } from "./errors.ts";
import { watchGitHead } from "./head-watcher.ts";
import type { GitInfo } from "./schemas.ts";

/** Strip embedded credentials (`https://user:token@host/…` → `https://host/…`)
 *  before a remote URL is persisted or published. scp-style `git@host:path`
 *  carries no secret and is returned unchanged. */
function stripRemoteCredentials(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

async function resolveRemoteUrl(
  git: SimpleGit,
  log?: Logger,
): Promise<string | null> {
  try {
    const url = (await git.raw(["remote", "get-url", "origin"])).trim();
    return url ? stripRemoteCredentials(url) : null;
  } catch (e) {
    log?.debug(
      { err: e instanceof Error ? e.message : String(e) },
      "git: no origin remote",
    );
    return null;
  }
}

/** Fast check: does a .git entry exist in this directory? (stat, not a git subprocess) */
export function hasGitDir(cwd: string): boolean {
  try {
    fs.accessSync(path.join(cwd, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Resolve git context for a directory. Returns an error result if not in a
 *  git repo or if the git command fails. */
export async function resolveGitInfo(
  cwd: string,
  log?: Logger,
): Promise<GitResult<GitInfo>> {
  try {
    const git = backgroundGit(cwd);
    const isBare =
      (await git.raw(["rev-parse", "--is-bare-repository"])).trim() === "true";
    if (isBare) {
      const gitDirAbs = await fs.promises.realpath(
        path.resolve(cwd, (await git.raw(["rev-parse", "--git-dir"])).trim()),
      );
      const gitDirBase = path.basename(gitDirAbs);
      const isDotGit = gitDirBase === ".git";
      const repoRoot = isDotGit ? path.dirname(gitDirAbs) : gitDirAbs;
      const repoName = isDotGit
        ? path.basename(repoRoot)
        : gitDirBase.replace(/\.git$/, "");
      let branch: string;
      try {
        branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
      } catch {
        branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
      }
      return ok({
        repoRoot,
        repoName,
        worktreePath: repoRoot,
        branch,
        isWorktree: false,
        mainRepoRoot: repoRoot,
        remoteUrl: await resolveRemoteUrl(git, log),
        isBare: true,
      });
    }
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    let branch: string;
    try {
      branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    } catch {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    }
    const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
    const mainRepoRoot = path.dirname(
      await fs.promises.realpath(path.resolve(cwd, gitCommonDir)),
    );
    const isWorktree = mainRepoRoot !== repoRoot;
    return ok({
      repoRoot,
      repoName: path.basename(mainRepoRoot),
      worktreePath: cwd,
      branch,
      isWorktree,
      mainRepoRoot,
      remoteUrl: await resolveRemoteUrl(git, log),
      isBare: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not a git repository/i.test(message)) {
      log?.debug({ err: message, cwd }, "git: not a repo");
      return err({ code: "NOT_A_REPO" });
    }
    log?.error({ err: message, cwd }, "git: resolveGitInfo failed");
    return err({ code: "GIT_FAILED", message });
  }
}

/** Compare two GitInfo values for equality. */
export function gitInfoEqual(a: GitInfo | null, b: GitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.branch === b.branch &&
    a.worktreePath === b.worktreePath &&
    a.remoteUrl === b.remoteUrl &&
    a.isBare === b.isBare
  );
}

/** Subscribe to the GitInfo stream for a cwd: initial resolve, dedup via
 *  `gitInfoEqual`, and the two watcher modes — `.git/HEAD` while in a repo, the
 *  cwd entry watcher while out, swapping as the resolved state flips.
 *
 *  `onChange` fires for the FIRST answer unconditionally, `null` (not a repo)
 *  included, then once per actual change. `stop()` tears down whichever watcher
 *  is active; `setCwd(next)` swaps the watched directory. */
type WatcherMode = "head" | "cwd";
type WatcherSlot = { mode: WatcherMode; stop: () => void };

export function subscribeGitInfo(
  initialCwd: string,
  asker: WatchAsker,
  onChange: (info: GitInfo | null) => void,
  log?: Logger,
): { setCwd(next: string): void; stop(): void } {
  let currentCwd = initialCwd;
  let currentInfo: GitInfo | null = null;
  let hasPublishedFirstAnswer = false;
  let watcher: WatcherSlot | null = null;
  let stopped = false;

  const resultIsForCurrentCwd = (cwdAtStart: string): boolean =>
    cwdAtStart === currentCwd;

  function handleWatcherEvent(): void {
    void resolve();
  }

  function install(mode: WatcherMode): () => void {
    if (mode === "cwd") {
      return watchCwdForGitDir(currentCwd, asker, handleWatcherEvent, log);
    }
    const stopHead = watchGitHead(currentCwd, asker, handleWatcherEvent, log);
    const stopConfig = watchGitConfig(
      currentCwd,
      asker,
      handleWatcherEvent,
      log,
    );
    return () => {
      stopHead();
      stopConfig();
    };
  }

  function ensureMode(mode: WatcherMode): void {
    if (watcher?.mode === mode) return;
    watcher?.stop();
    watcher = { mode, stop: install(mode) };
  }

  function tearDownWatchers(): void {
    watcher?.stop();
    watcher = null;
  }

  async function resolve(): Promise<void> {
    const cwdAtStart = currentCwd;
    const result = await resolveGitInfo(cwdAtStart, log);
    if (stopped || !resultIsForCurrentCwd(cwdAtStart)) return;
    if (!result.ok && result.error.code !== "NOT_A_REPO") {
      log?.error(
        { code: result.error.code, cwd: currentCwd },
        "git resolution failed",
      );
      ensureMode("cwd");
      return;
    }
    const next: GitInfo | null = result.ok ? result.value : null;
    ensureMode(next !== null ? "head" : "cwd");
    if (hasPublishedFirstAnswer && gitInfoEqual(next, currentInfo)) return;
    hasPublishedFirstAnswer = true;
    currentInfo = next;
    onChange(next);
  }

  ensureMode(hasGitDir(currentCwd) ? "head" : "cwd");
  void resolve();

  return {
    setCwd(next: string): void {
      if (stopped) return;
      if (next === currentCwd) {
        if (currentInfo === null && hasGitDir(next)) void resolve();
        return;
      }
      currentCwd = next;
      tearDownWatchers();
      ensureMode(hasGitDir(next) ? "head" : "cwd");
      void resolve();
    },
    stop(): void {
      stopped = true;
      tearDownWatchers();
    },
  };
}
