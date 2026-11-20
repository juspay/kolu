import fs from "node:fs";
import { createDirFilenameWatcher } from "kolu-io";
import { WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const cwdGitWatcher = createDirFilenameWatcher({
  // macOS `/tmp` symlinks to `/private/tmp`, and darwin FSEvents reports
  // directory-entry events under the realpath, so watching the raw symlinked
  // path never sees `filename === ".git"`.
  resolveDir: async (cwd) => {
    try {
      return await fs.promises.realpath(cwd);
    } catch {
      return cwd;
    }
  },
  filename: ".git",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: cwd",
});

export const watchCwdForGitDir = cwdGitWatcher.watch;

export const _sharedCwdGitWatcherCount = cwdGitWatcher._watcherCount;

export const _settledSharedCwdGitWatchers = cwdGitWatcher._whenSettled;

export const _resetSharedCwdGitWatchers = cwdGitWatcher._reset;
