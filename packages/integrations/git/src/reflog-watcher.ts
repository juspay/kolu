import fs from "node:fs";
import path from "node:path";
import { createDirFilenameWatcher } from "kolu-io";
import { resolveGitDir, WATCHER_DEBOUNCE_MS } from "./git-dir.ts";

const reflogWatcher = createDirFilenameWatcher({
  resolveDir: async (cwd) => {
    const gitDir = await resolveGitDir(cwd);
    if (gitDir === null) return null;
    const logsDir = path.join(gitDir, "logs");
    try {
      await fs.promises.access(logsDir);
      return logsDir;
    } catch {
      return null;
    }
  },
  filename: "HEAD",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: reflog",
});

/** Watch `.git/logs/HEAD` for changes (every HEAD movement). Returns a
 *  no-op for non-git directories or repos that haven't created `logs/`
 *  yet (a fresh `git init` with no commits — the first HEAD movement
 *  creates the dir, and a subscribe after that point installs cleanly). */
export const watchGitReflog = reflogWatcher.watch;

export const _sharedReflogWatcherCount = reflogWatcher._watcherCount;
