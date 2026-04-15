/**
 * Git repository resolution — resolves repo context from a directory path.
 *
 * Pure git operations with no server dependencies. The server's metadata
 * provider calls these functions and bridges results into its event system.
 */

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import type { Logger } from "anyagent";
import type { GitInfo } from "./schemas.ts";
import { type GitResult, ok, err } from "./errors.ts";

const DEBOUNCE_MS = 150;

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
      return ok({
        repoRoot,
        repoName,
        worktreePath: repoRoot,
        branch,
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

/**
 * Watch .git/HEAD for changes (branch switches, checkout, etc.).
 * Returns a cleanup function. Returns a no-op for non-git directories.
 */
export function watchGitHead(
  cwd: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  let gitDir: string;
  try {
    const result = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitDir = path.resolve(cwd, result.trim());
  } catch {
    // Expected in non-git directories — watchGitHead is called speculatively.
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(gitDir, (_, filename) => {
      if (filename !== "HEAD") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, DEBOUNCE_MS);
    });
  } catch (e) {
    log?.debug(
      { err: e instanceof Error ? e.message : String(e), gitDir },
      "git: failed to watch git dir",
    );
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

/** Compare two GitInfo values for equality. */
export function gitInfoEqual(a: GitInfo | null, b: GitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.branch === b.branch &&
    a.worktreePath === b.worktreePath
  );
}
