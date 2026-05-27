/**
 * Refcounted shared watcher for `.git` *appearing* in a cwd.
 *
 * The companion to `watchGitHead`: that one fires on changes inside `.git/`
 * once a repo exists, this one fires on the `.git` entry itself appearing
 * (or disappearing) in a directory we treat as not-a-repo. The motivating
 * case is `git init` in the current shell cwd — the shell never re-emits
 * OSC 7 because the cwd didn't change, so the metadata provider would
 * otherwise stay stuck on "not a git repository" forever.
 *
 * Implementation reuses `createDirFilenameWatcher`: one `fs.watch(cwd)` per
 * cwd, debounced, filter on filename `.git`. N callers on the same cwd
 * collapse to one OS handle.
 */

import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";
import { createDirFilenameWatcher } from "kolu-io";

const cwdGitWatcher = createDirFilenameWatcher({
  resolveDir: (cwd) => cwd,
  filename: ".git",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: cwd",
});

export const watchCwdForGitDir = cwdGitWatcher.watch;

/** Test-only inspector — number of distinct cwds with active shared
 *  watchers. Mirrors `_sharedHeadWatcherCount`. */
export const _sharedCwdGitWatcherCount = cwdGitWatcher._watcherCount;

/** Test-only teardown — symmetric with `_resetSharedHeadWatchers`. See
 *  there for the cascade-breaking rationale (#955). Production code must
 *  never call this. */
export const _resetSharedCwdGitWatchers = cwdGitWatcher._reset;
