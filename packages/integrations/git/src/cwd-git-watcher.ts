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

import fs from "node:fs";
import { createDirFilenameWatcher } from "kolu-io";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const cwdGitWatcher = createDirFilenameWatcher({
  // Canonicalize the cwd before `fs.watch`: macOS `/tmp` symlinks to
  // `/private/tmp`, and on darwin FSEvents reports directory-entry events
  // under the realpath. Watching the raw symlinked path means the `.git`
  // create event never arrives with `filename === ".git"`, so the cwd→head
  // swap never fires and `git init` in a symlinked cwd is missed. The
  // sibling HEAD/index/reflog watchers already realpath via `resolveGitDir`
  // for the same reason. Fall back to the raw cwd if realpath throws (e.g.
  // the dir was removed mid-flight). No-op on Linux, where `/tmp` is a real
  // directory.
  resolveDir: (cwd) => {
    try {
      return fs.realpathSync(cwd);
    } catch {
      return cwd;
    }
  },
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
