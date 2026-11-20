import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

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
