import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const headWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitDir,
  filename: "HEAD",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: head",
});

export const watchGitHead = headWatcher.watch;

export const _sharedHeadWatcherCount = headWatcher._watcherCount;

export const _settledSharedHeadWatchers = headWatcher._whenSettled;

export const _resetSharedHeadWatchers = headWatcher._reset;
