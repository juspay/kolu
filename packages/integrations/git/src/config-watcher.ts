/**
 * Refcounted shared `.git/config` watcher.
 *
 * Catches remote-URL changes (`git remote set-url`, `git remote add/rename`)
 * — anything that rewrites `.git/config`. `subscribeGitInfo` pairs this with
 * `watchGitHead` in head mode so a remote change re-resolves `GitInfo` (and
 * thus re-dispatches forge detection) without waiting for a branch or cwd
 * change. For worktrees the resolved gitDir is the main repo's `.git`, where
 * `config` (and `remote.origin.url`) actually lives — shared across every
 * worktree — so one watcher per repo covers them all.
 *
 * Implementation is the same thin specialization of the generic shared
 * dir+filename watcher as `watchGitHead`: one `fs.watch(gitDir)` per gitDir,
 * debounce 150ms, filename filter `config`. N callers watching the same
 * gitDir collapse to one OS handle and one debounce timer.
 */

import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const configWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitDir,
  filename: "config",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: config",
});

export const watchGitConfig = configWatcher.watch;

/** Test-only inspector — number of distinct gitDirs with active shared
 *  watchers. Mirrors `_sharedHeadWatcherCount`. */
export const _sharedConfigWatcherCount = configWatcher._watcherCount;

/** Test-only teardown — close every active config-watcher and clear the
 *  singleton's registry. Production code must never call this; it exists so
 *  vitest `beforeEach` can break the module-scope leak that turns one
 *  timed-out test into a whole-file `afterEach` cascade (#955). */
export const _resetSharedConfigWatchers = configWatcher._reset;
