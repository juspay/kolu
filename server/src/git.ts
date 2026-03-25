/** Git context resolver — enriches CWD paths with repo/branch metadata. */

import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { GitInfo, CwdInfo } from "kolu-common";
import { log } from "./log.ts";

/** Build a CwdInfo by resolving git context for the given path. */
export async function toCwdInfo(cwd: string): Promise<CwdInfo> {
  return { cwd, git: await resolveGitInfo(cwd) };
}

/** Resolve git context for a directory. Returns null if not in a git repo. */
async function resolveGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const git = simpleGit(cwd);
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    // symbolic-ref works in both normal and empty repos (no commits yet).
    // Falls back to rev-parse for detached HEAD (returns commit-ish).
    let branch: string;
    try {
      branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    } catch {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    }
    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      worktreePath: cwd,
      branch,
    };
  } catch {
    return null;
  }
}

const GIT_WATCH_DEBOUNCE_MS = 100;

/**
 * Watch `.git` metadata for branch/HEAD changes. Yields `undefined` whenever
 * the HEAD ref changes (branch switch, commit, rebase, etc.).
 *
 * Resolves the git dir via `git rev-parse --git-dir` so worktrees are
 * supported. Watches the resolved HEAD file (following symrefs).
 * Returns empty iterable for non-git directories.
 */
export async function* watchGitDir(
  cwd: string,
  signal: AbortSignal,
): AsyncGenerator<void> {
  let gitDir: string;
  try {
    const git = simpleGit(cwd);
    gitDir = (await git.revparse(["--git-dir"])).trim();
    // Make absolute if relative (git rev-parse --git-dir returns relative in worktrees)
    if (!path.isAbsolute(gitDir)) {
      gitDir = path.resolve(cwd, gitDir);
    }
  } catch {
    return; // Not a git repo — nothing to watch
  }

  // Watch the HEAD file — it changes on branch switch, commit, rebase, etc.
  const headPath = path.join(gitDir, "HEAD");
  const glog = log.child({ gitDir });
  glog.debug({ headPath }, "watching git HEAD");

  const queue: void[] = [];
  let resolveNext: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const enqueue = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      queue.push();
      resolveNext?.();
    }, GIT_WATCH_DEBOUNCE_MS);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(headPath, { persistent: false }, () => enqueue());
  } catch {
    glog.debug("failed to watch HEAD file");
    return; // HEAD file doesn't exist or not watchable
  }

  // Also watch refs/heads/ for commits on the current branch (HEAD file
  // doesn't change on commit — only the ref it points to does).
  const refsDir = path.join(gitDir, "refs", "heads");
  let refsWatcher: fs.FSWatcher | undefined;
  try {
    refsWatcher = fs.watch(
      refsDir,
      { persistent: false, recursive: true },
      () => enqueue(),
    );
  } catch {
    // refs/heads may not exist yet (empty repo) — that's fine
  }

  const cleanup = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    refsWatcher?.close();
    resolveNext?.();
  };
  signal.addEventListener("abort", cleanup, { once: true });

  try {
    while (!signal.aborted) {
      if (queue.length > 0) {
        queue.shift();
        glog.debug("git HEAD changed");
        yield;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      resolveNext = null;
    }
  } finally {
    cleanup();
    signal.removeEventListener("abort", cleanup);
  }
}
