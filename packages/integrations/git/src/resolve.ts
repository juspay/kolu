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
import { err, type GitResult, ok } from "./errors.ts";
import { watchGitMetadata } from "./head-watcher.ts";
import type { GitInfo } from "./schemas.ts";

function redactRemoteUrl(raw: string): string {
  const value = raw.trim();
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.toString();
    }
  } catch {
    return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1");
  }
  return value;
}

async function readRemoteUrl(
  git: ReturnType<typeof simpleGit>,
): Promise<string | null> {
  const remotes = (await git.raw(["remote"]))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (!remote) return null;
  const url = (await git.raw(["remote", "get-url", remote])).trim();
  return url ? redactRemoteUrl(url) : null;
}

async function resolveRemoteUrl(
  git: ReturnType<typeof simpleGit>,
  cwd: string,
  log?: Logger,
): Promise<string | null> {
  try {
    return await readRemoteUrl(git);
  } catch (e) {
    log?.warn(
      { err: e instanceof Error ? e.message : String(e), cwd },
      "git: remote url unavailable",
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
      const remoteUrl = await resolveRemoteUrl(git, cwd, log);
      return ok({
        repoRoot,
        repoName,
        worktreePath: repoRoot,
        branch,
        remoteUrl,
        isWorktree: false,
        mainRepoRoot: repoRoot,
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
    const remoteUrl = await resolveRemoteUrl(git, cwd, log);
    const mainRepoRoot = path.dirname(
      fs.realpathSync(path.resolve(cwd, gitCommonDir)),
    );
    const isWorktree = mainRepoRoot !== repoRoot;
    return ok({
      repoRoot,
      repoName: path.basename(mainRepoRoot),
      worktreePath: cwd,
      branch,
      remoteUrl,
      isWorktree,
      mainRepoRoot,
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
    a.remoteUrl === b.remoteUrl
  );
}

/**
 * Subscribe to the GitInfo stream for a cwd. Owns the full resolve + watch
 * + re-resolve loop: initial resolve, `.git/HEAD`/config watcher, debounced
 * re-resolve on branch or remote change, dedup via `gitInfoEqual`, and `git init` detection
 * (a same-cwd `setCwd` call on a not-yet-a-repo checks `.git` existence and
 * re-resolves if it appeared since the last resolve).
 *
 * `onChange` fires once per actual change — never for a dedup miss. Initial
 * resolve is best-effort: if the cwd isn't a git repo at start, the watcher
 * sits idle (git watch is a no-op on non-git dirs per `watchGitMetadata`) until
 * `setCwd` tells it to re-check.
 *
 * Callers are the sole source of truth for current GitInfo — never re-read
 * the value elsewhere to drive control flow. The returned handle's `stop()`
 * tears down the git metadata watcher; `setCwd(next)` swaps the watched
 * directory.
 */
export function subscribeGitInfo(
  initialCwd: string,
  onChange: (info: GitInfo | null) => void,
  log?: Logger,
): { setCwd(next: string): void; stop(): void } {
  let currentCwd = initialCwd;
  let currentInfo: GitInfo | null = null;
  let stopGitWatch = watchGitMetadata(currentCwd, handleGitChange, log);

  function handleGitChange(): void {
    void resolve();
  }

  async function resolve(): Promise<void> {
    const result = await resolveGitInfo(currentCwd, log);
    const next: GitInfo | null = result.ok ? result.value : null;
    if (!result.ok && result.error.code !== "NOT_A_REPO") {
      log?.error(
        { code: result.error.code, cwd: currentCwd },
        "git resolution failed",
      );
    }
    if (gitInfoEqual(next, currentInfo)) return;
    currentInfo = next;
    onChange(next);
  }

  // Initial resolve — covers repos that exist at subscribe time.
  void resolve();

  return {
    setCwd(next: string): void {
      if (next === currentCwd) {
        // Same cwd — only act if the repo state might have changed from
        // outside. Today that's exactly one case: we thought this dir wasn't
        // a repo and `.git` has since appeared (e.g. `git init`). The
        // existing git watch is a no-op (install failed for a non-git dir),
        // so re-install here so the new repo's metadata changes propagate.
        if (currentInfo === null && hasGitDir(next)) {
          stopGitWatch();
          stopGitWatch = watchGitMetadata(next, handleGitChange, log);
          void resolve();
        }
        return;
      }
      currentCwd = next;
      stopGitWatch();
      stopGitWatch = watchGitMetadata(next, handleGitChange, log);
      void resolve();
    },
    stop(): void {
      stopGitWatch();
    },
  };
}
