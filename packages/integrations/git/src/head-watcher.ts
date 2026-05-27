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

import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { createDirFilenameWatcher } from "kolu-io";

const headWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitDir,
  filename: "HEAD",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: head",
});

export const watchGitHead = headWatcher.watch;

/** Test-only inspector — number of distinct gitDirs with active shared
 *  watchers. Used by unit tests to assert the singleton invariant without
 *  spying on `fs.watch`. */
export const _sharedHeadWatcherCount = headWatcher._watcherCount;

/** Test-only teardown — close every active head-watcher and clear the
 *  singleton's registry. Production code must never call this; it exists
 *  so vitest `beforeEach` can break the module-scope leak that turns one
 *  timed-out test into a whole-file `afterEach` cascade (#955). */
export const _resetSharedHeadWatchers = headWatcher._reset;
