/**
 * Git repository resolution — resolves repo context from a directory path.
 *
 * Pure git operations with no server dependencies. The server's metadata
 * provider calls these functions and bridges results into its event system.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { simpleGit } from "simple-git";
import { watchGitConfig } from "./config-watcher.ts";
import { watchCwdForGitDir } from "./cwd-git-watcher.ts";
import { err, type GitResult, ok } from "./errors.ts";
import { watchGitHead } from "./head-watcher.ts";
import type { GitInfo } from "./schemas.ts";

/** Fast check: does a .git entry exist in this directory? (stat, not a git subprocess) */
export function hasGitDir(cwd: string): boolean {
  try {
    fs.accessSync(path.join(cwd, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Strip any embedded credentials from a remote URL before it leaves this
 *  module. An HTTPS remote can carry a username + token in its userinfo
 *  (`https://user:token@host/repo.git`); that value is persisted on
 *  `GitInfo`, published through terminal metadata, and round-tripped to
 *  disk, so it must never reach the client surface or the state file.
 *  Downstream only needs the host (forge detection) and `gh` re-derives the
 *  remote itself, so dropping userinfo costs nothing. Returns the input
 *  unchanged for non-URL forms (SCP shorthand has no parseable userinfo to
 *  redact — `git@host:owner/repo` carries the SSH user, not a secret). */
function stripRemoteCredentials(remoteUrl: string): string {
  try {
    const url = new URL(remoteUrl);
    if (!url.username && !url.password) return remoteUrl;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    // Not a parseable URL (SCP shorthand, local path) — nothing to redact.
    return remoteUrl;
  }
}

/** Best-effort `origin` URL, with any embedded credentials stripped (see
 *  `stripRemoteCredentials`). Returns null when the repo has no `origin`
 *  remote or the command fails — forge detection downstream treats null
 *  as "dispatch to the default adapter" and stays quiet. */
async function resolveRemoteUrl(
  git: ReturnType<typeof simpleGit>,
  log?: Logger,
): Promise<string | null> {
  try {
    const raw = (await git.raw(["remote", "get-url", "origin"])).trim();
    return raw ? stripRemoteCredentials(raw) : null;
  } catch (e) {
    // `catch (e)`, not `catch (err)` — the sibling `resolveGitInfo` catch does
    // the same, and `err` is the Result constructor imported from ./errors.ts.
    const message = e instanceof Error ? e.message : String(e);
    // "no origin remote" is the expected case — log at debug. Any other git
    // failure (a broken repo, a hung subprocess) still degrades gracefully to
    // the default-adapter dispatch, so it's a warn, not an error, but it
    // shouldn't hide silently as if there were simply no remote.
    if (/no such remote|no.*remote|origin/i.test(message)) {
      log?.debug({ err: message }, "git: no origin remote");
    } else {
      log?.warn({ err: message }, "git: remote get-url failed");
    }
    return null;
  }
}

/** Resolve git context for a directory. Returns an error result if not in a
 *  git repo or if the git command fails. */
export async function resolveGitInfo(
  cwd: string,
  log?: Logger,
): Promise<GitResult<GitInfo>> {
  try {
    const git = simpleGit(cwd);
    // Bare repos (core.bare=true) have no work tree, so `--show-toplevel`
    // throws on them. Detect up front and return a GitInfo rooted at the
    // bare repo's own location — the palette consumer treats the result as
    // "a repo you can spawn a worktree from," which is exactly right.
    const isBare =
      (await git.raw(["rev-parse", "--is-bare-repository"])).trim() === "true";
    if (isBare) {
      // Derive the repo location from `--git-dir`, not cwd. For a canonical
      // bare repo (`/tmp/foo` bare, cwd == bare dir) the two coincide. For
      // project layouts where a bare `.git` sits inside a working dir
      // (`/home/user/proj/.git` with sibling `proj/.worktrees/`), cwd can be
      // anywhere around `.git` — falling back to `basename(cwd)` would
      // report the wrong name (e.g. `.worktrees`).
      const gitDirAbs = fs.realpathSync(
        path.resolve(cwd, (await git.raw(["rev-parse", "--git-dir"])).trim()),
      );
      const gitDirBase = path.basename(gitDirAbs);
      // Three shapes:
      //   /proj/.git        → root /proj,        name proj
      //   /foo.git          → root /foo.git,     name foo
      //   /foo (bare dir)   → root /foo,         name foo
      const isDotGit = gitDirBase === ".git";
      const repoRoot = isDotGit ? path.dirname(gitDirAbs) : gitDirAbs;
      const repoName = isDotGit
        ? path.basename(repoRoot)
        : gitDirBase.replace(/\.git$/, "");
      let branch: string;
      try {
        branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
      } catch {
        // Detached HEAD in a bare repo (unusual but possible).
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
      });
    }
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    let branch: string;
    try {
      branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    } catch {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    }
    // --git-common-dir returns the shared .git dir; for worktrees it points
    // back to the main repo's .git, letting us derive the real repo name.
    // The path is relative to cwd (where simple-git runs), not repoRoot.
    // realpathSync normalizes symlinks (e.g. /tmp → /private/tmp on macOS)
    // so the comparison with repoRoot (which git already resolved) is reliable.
    const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
    const mainRepoRoot = path.dirname(
      fs.realpathSync(path.resolve(cwd, gitCommonDir)),
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
    });
  } catch (e) {
    // Log so unexpected failures (permission errors, missing git binary)
    // surface instead of being silently treated as "not a repo".
    const message = e instanceof Error ? e.message : String(e);
    // "not a git repository" is the expected case — log at debug, not error.
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
    // A remote change re-triggers downstream consumers (the PR watcher
    // dispatches per resolve on the remote's forge).
    a.remoteUrl === b.remoteUrl
  );
}

/**
 * Subscribe to the GitInfo stream for a cwd. Owns the full resolve + watch
 * + re-resolve loop: initial resolve, dedup via `gitInfoEqual`, and the
 * two watcher modes — `.git/HEAD` + `.git/config` while in a repo, the cwd
 * entry watcher while out, swapping as the resolved state flips. Watching
 * config alongside HEAD is what makes `git remote set-url` re-resolve (and
 * re-dispatch forge detection) without waiting for a branch change. The cwd
 * watcher is what makes `git init` in the current shell cwd reach the client
 * without an OSC 7 re-emit (the shell doesn't re-emit because cwd didn't
 * change).
 *
 * `onChange` fires once per actual change — never for a dedup miss. Initial
 * resolve is best-effort: if the cwd isn't a git repo at start, the cwd
 * watcher sits waiting for `.git` to appear; the HEAD watcher takes over
 * once it does.
 *
 * Callers are the sole source of truth for current GitInfo — never re-read
 * the value elsewhere to drive control flow. The returned handle's `stop()`
 * tears down whichever watcher is active; `setCwd(next)` swaps the watched
 * directory.
 */
type WatcherMode = "head" | "cwd";
type WatcherSlot = { mode: WatcherMode; stop: () => void };

export function subscribeGitInfo(
  initialCwd: string,
  onChange: (info: GitInfo | null) => void,
  log?: Logger,
): { setCwd(next: string): void; stop(): void } {
  let currentCwd = initialCwd;
  let currentInfo: GitInfo | null = null;
  // Head mode watches `.git/HEAD` (in-repo); cwd mode watches the parent
  // for `.git` appearing (out-of-repo). The two are mutually exclusive.
  let watcher: WatcherSlot | null = null;
  // Set by `stop()` so an in-flight `resolve()` that resumes after teardown
  // can't re-install a watcher via `ensureMode` — the resulting orphan
  // would leak past the subscription's lifetime.
  let stopped = false;

  function handleWatcherEvent(): void {
    void resolve();
  }

  function install(mode: WatcherMode): () => void {
    if (mode === "cwd") {
      return watchCwdForGitDir(currentCwd, handleWatcherEvent, log);
    }
    // Head mode watches two files: `HEAD` (branch identity, in the
    // per-worktree git dir) and `config` (remote URL, in the common git
    // dir — they differ in a linked worktree). A `git remote set-url`
    // rewrites config but not HEAD, so without the config watch a remote
    // change wouldn't re-resolve until the next branch/cwd change — leaving
    // forge dispatch stale. Both feed the same `handleWatcherEvent`; combine
    // their stops.
    const stopHead = watchGitHead(currentCwd, handleWatcherEvent, log);
    const stopConfig = watchGitConfig(currentCwd, handleWatcherEvent, log);
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
    // Discard the result if the subscription was stopped during the await:
    // `ensureMode` would otherwise install a fresh watcher with no path to
    // retire it, and `onChange` would fire past the caller's stop barrier.
    if (stopped) return;
    // Discard the result if cwd flipped during the await — a fresh resolve
    // is already in flight for the new cwd and will publish the right
    // state. Acting on a stale cwd here would re-swap watchers and emit a
    // GitInfo for a directory we're no longer in.
    if (cwdAtStart !== currentCwd) return;
    const next: GitInfo | null = result.ok ? result.value : null;
    if (!result.ok && result.error.code !== "NOT_A_REPO") {
      log?.error(
        { code: result.error.code, cwd: currentCwd },
        "git resolution failed",
      );
    }
    ensureMode(next !== null ? "head" : "cwd");
    if (gitInfoEqual(next, currentInfo)) return;
    currentInfo = next;
    onChange(next);
  }

  // Install synchronously so fs events during the first `resolve()` await
  // aren't dropped on the floor.
  ensureMode(hasGitDir(currentCwd) ? "head" : "cwd");
  void resolve();

  return {
    setCwd(next: string): void {
      if (stopped) return;
      if (next === currentCwd) {
        // Same cwd — the cwd watcher catches `.git` appearing. This is a
        // belt-and-braces re-resolve for platforms or filesystems where the
        // watcher might miss the event (e.g. polling fallback under a
        // bind-mounted container fs).
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
