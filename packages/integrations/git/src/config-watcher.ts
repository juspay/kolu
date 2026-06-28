/**
 * Refcounted shared `.git/config` watcher.
 *
 * Catches remote-URL changes (`git remote set-url`, `git remote add origin`)
 * — edits to `[remote "…"]` in the repo's shared config — which the HEAD
 * watcher misses (they don't touch HEAD). Lets `subscribeGitInfo` re-resolve
 * `remoteUrl` when the origin changes without a branch switch.
 *
 * Watches the COMMON git dir (`--git-common-dir`), not the per-worktree dir:
 * `config` is shared across a repo's worktrees, so they all collapse to one
 * OS handle here. A thin specialization of the generic shared dir+filename
 * watcher, exactly like `watchGitHead`.
 */

import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitCommonDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const configWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitCommonDir,
  filename: "config",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: config",
});

export const watchGitConfig = configWatcher.watch;

/** Test-only inspector — number of distinct common git dirs with active
 *  shared watchers. Used by index.test.ts to assert the singleton invariant
 *  (and that a repo's worktrees collapse to one handle) without spying on
 *  `fs.watch`. */
export const _sharedConfigWatcherCount = configWatcher._watcherCount;

/** Test-only barrier — resolves once every in-flight `watchGitConfig`
 *  resolution has installed or cancelled. Await before reading the count. */
export const _settledSharedConfigWatchers = configWatcher._whenSettled;

/** Test-only teardown — close every active config-watcher and clear the
 *  singleton's registry. Production code must never call this; it exists so
 *  vitest `beforeEach` can break the module-scope leak that turns one
 *  timed-out test into a whole-file `afterEach` cascade (#955). */
export const _resetSharedConfigWatchers = configWatcher._reset;
