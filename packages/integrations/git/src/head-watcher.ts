/**
 * Refcounted shared `.git/HEAD` watcher.
 *
 * Catches branch identity changes (`git checkout`, `git switch`, detached
 * HEAD) — anything that rewrites `.git/HEAD`'s contents. Does **not** catch
 * commits on the current branch: those move the branch ref under HEAD but
 * leave HEAD itself unchanged. That axis lives in `watchGitReflog`.
 *
 * Implementation is a thin specialization of the generic shared
 * dir+filename watcher: one `fs.watch(gitDir)` per gitDir, debounce 150ms,
 * filename filter `HEAD`. N callers watching the same gitDir collapse to
 * one OS handle and one debounce timer.
 */

import { resolveGitDir } from "./git-dir.ts";
import { createDirFilenameWatcher } from "./shared-dir-filename-watcher.ts";

const headWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitDir,
  filename: "HEAD",
  debounceMs: 150,
  logLabel: "git: head",
});

/**
 * Watch .git/HEAD for changes (branch switches, checkout, etc.).
 * Returns a cleanup function. Returns a no-op for non-git directories.
 *
 * N callers watching the same `gitDir` share a single `fs.watch` handle
 * and a single debounce timer. Cost per HEAD event is O(listeners)
 * regardless of how many terminals subscribed.
 */
export const watchGitHead = headWatcher.watch;

/** Test-only inspector — number of distinct gitDirs with active shared
 *  watchers. Used by unit tests to assert the singleton invariant without
 *  spying on `fs.watch`. */
export const _sharedHeadWatcherCount = headWatcher._watcherCount;
