/**
 * Refcounted shared `.git/index` watcher.
 *
 * Catches staging-area changes — `git add`, `git rm`, `git restore --staged`,
 * partial commits, merges. Editor saves do not touch `.git/index`; that
 * axis is `watchWorkingTree`.
 *
 * Same dir+filename pattern as `head-watcher.ts` — both watch the gitDir
 * itself and filter for the file of interest. Two filter-keyed watchers on
 * the same gitDir don't share an `fs.watch` handle (one per filter); the
 * cost is one extra inotify watch per repo, traded for keeping the
 * abstraction uniform across axes.
 */

import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { createDirFilenameWatcher } from "@kolu/dir-watch";

const indexWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitDir,
  filename: "index",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: index",
});

/** Watch `.git/index` for changes (`git add`, `git rm`, etc.). Returns a
 *  no-op for non-git directories. */
export const watchGitIndex = indexWatcher.watch;

export const _sharedIndexWatcherCount = indexWatcher._watcherCount;
