/**
 * `subscribeDirChange(rootPath, dirPath)` — the WATCH counterpart to
 * `browse.ts`'s `listDirectory`, for browse roots that are NOT git repos
 * (plain-directory browsing in the Code tab). Where `subscribeRepoChange`
 * stands on the recursive, gitignore-pruned working-tree watcher — affordable
 * only because git's ignore listing bounds it — this subscribes ONE directory,
 * non-recursively, so watching stays cheap no matter how large the subtree
 * beneath it is. Lazy listing and lazy watching are the same decision: only
 * what the user expanded is ever read or watched.
 *
 * The whole file is a CONFIG of `kolu-io`'s `createDirWatcher` — no machinery
 * of its own. The capability ("share one non-recursive handle per resolved
 * directory, with a level-triggered recovery poll and a post-install reconcile
 * tick") is domain-agnostic and lives in `kolu-io`, whose `resolveDir` seam is
 * the injection point for a traversal guard; what is left here is the git-side
 * BINDING of that seam to `resolveExistingUnder`. Nothing below consults git,
 * which is why it is a config and not a module of its own machinery.
 *
 * The traversal guard is every browse read's: the directory key arrives over
 * the wire, so it resolves through `resolveExistingUnder` (lexical +
 * symlink-resolving) before any handle attaches. Resolution is async, so the
 * unsubscribe returns synchronously and the handle attaches on a later tick;
 * a change landing in that window is covered by the factory's post-attach
 * reconcile tick. A path that fails resolution — escaped root, vanished
 * directory — resolves to `null` and installs nothing (the paired
 * `listDirectory` read is the loud authority on that failure;
 * `resolveExistingUnder` already logs the escape at error level).
 */

import { COALESCE_DEBOUNCE_MS, createDirWatcher } from "kolu-io";
import type { Logger } from "kolu-shared";
import { resolveExistingUnder } from "./safe-path.ts";

const dirWatcher = createDirWatcher<{ rootPath: string; dirPath: string }>({
  // No `filename`: every direct-child event on the resolved directory is a
  // change to what that browse level lists.
  resolveDir: async ({ rootPath, dirPath }, log) => {
    const resolved = await resolveExistingUnder(rootPath, dirPath, log);
    return resolved.ok ? resolved.value.abs : null;
  },
  debounceMs: COALESCE_DEBOUNCE_MS,
  logLabel: "browse: dir-change",
});

/** Subscribe to debounced change ticks for one directory's direct children,
 *  `dirPath` relative to `rootPath` (`""` for the root itself). Returns the
 *  unsubscribe synchronously. Two roots naming the same real directory share
 *  one handle — the registry is keyed by the RESOLVED path. */
export function subscribeDirChange(
  rootPath: string,
  dirPath: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  return dirWatcher.watch({ rootPath, dirPath }, onChange, log);
}

/** Test-only inspector — number of distinct resolved directories with active
 *  shared watchers. */
export const _sharedDirChangeCount = dirWatcher._watcherCount;

/** Test-only barrier — resolves once every in-flight `subscribeDirChange`
 *  resolution has installed or cancelled. Await before reading the count. */
export const _settledSharedDirChangeWatchers = dirWatcher._whenSettled;

/** Test-only teardown — close every active dir-change watcher and clear the
 *  registry (the #955 vitest-cascade guard). Production code must never call
 *  it. */
export const _resetSharedDirChangeWatchers = dirWatcher._reset;
