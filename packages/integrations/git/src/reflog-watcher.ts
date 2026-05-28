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

import fs from "node:fs";
import path from "node:path";
import { createDirFilenameWatcher } from "@kolu/dir-watch";
import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const reflogWatcher = createDirFilenameWatcher({
  resolveDir: (cwd) => {
    const gitDir = resolveGitDir(cwd);
    if (gitDir === null) return null;
    const logsDir = path.join(gitDir, "logs");
    // A fresh `git init` with no commits has no `.git/logs/` yet — treat
    // that as "axis-not-watchable-here" silently. The first commit creates
    // the dir but won't trigger this watcher (we already returned no-op
    // for the original subscribe). Other axes catch the first-commit case
    // (HEAD content change, index update); a reflog-only event before
    // any commit isn't a thing.
    return fs.existsSync(logsDir) ? logsDir : null;
  },
  filename: "HEAD",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: reflog",
});

/** Watch `.git/logs/HEAD` for changes (every HEAD movement). Returns a
 *  no-op for non-git directories or repos that haven't created `logs/`
 *  yet (a fresh `git init` with no commits — the first HEAD movement
 *  creates the dir, and a subscribe after that point installs cleanly). */
export const watchGitReflog = reflogWatcher.watch;

export const _sharedReflogWatcherCount = reflogWatcher._watcherCount;
