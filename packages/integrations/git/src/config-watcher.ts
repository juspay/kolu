import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitCommonDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const configWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitCommonDir,
  filename: "config",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: config",
});

export const watchGitConfig = configWatcher.watch;

export const _sharedConfigWatcherCount = configWatcher._watcherCount;

export const _settledSharedConfigWatchers = configWatcher._whenSettled;

export const _resetSharedConfigWatchers = configWatcher._reset;
