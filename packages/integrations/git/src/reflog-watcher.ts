/**
 * Refcounted shared `.git/logs/HEAD` watcher.
 *
 * Catches HEAD movements that don't rewrite `.git/HEAD` — commits on the
 * current branch, rebases, merges, resets, fast-forward pulls. Branch
 * identity changes (the file `.git/HEAD` itself) are owned by
 * `watchGitHead`. The two together cover all HEAD-related volatility.
 *
 * `.git/logs/HEAD` updates on every HEAD movement and is a stable path
 * (vs. `.git/refs/heads/<current-branch>`, which moves on every branch
 * switch). Same dir+filename pattern as `head-watcher.ts`.
 */

import path from "node:path";
import { resolveGitDir } from "./git-dir.ts";
import { createDirFilenameWatcher } from "./shared-dir-filename-watcher.ts";

const reflogWatcher = createDirFilenameWatcher({
  resolveDir: (cwd) => {
    const gitDir = resolveGitDir(cwd);
    return gitDir === null ? null : path.join(gitDir, "logs");
  },
  filename: "HEAD",
  debounceMs: 150,
  logLabel: "git: reflog",
});

/** Watch `.git/logs/HEAD` for changes (every HEAD movement). Returns a
 *  no-op for non-git directories or repos that haven't created `logs/`
 *  yet (a fresh `git init` with no commits — the first HEAD movement
 *  creates the dir, and a subscribe after that point installs cleanly). */
export const watchGitReflog = reflogWatcher.watch;

export const _sharedReflogWatcherCount = reflogWatcher._watcherCount;
