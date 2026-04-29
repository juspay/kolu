/** Shared constants and helpers for the live Code-view watcher layer.
 *
 *  `resolveGitDir` is the gitDir lookup the three git-dir watchers
 *  (`watchGitHead`, `watchGitReflog`, `watchGitIndex`) share. For a
 *  regular repo it returns `<repoRoot>/.git`; for worktrees it points at
 *  the main repo's `.git` (where `HEAD`, `index`, and `logs/` actually
 *  live). Synchronous because watchers install once at subscribe time.
 *
 *  `WATCHER_DEBOUNCE_MS` is the trailing-edge debounce window every
 *  watcher and composed primitive in this layer uses. Tuned for editor
 *  save bursts and inotify multi-fire patterns; co-located here so a
 *  retune touches one constant. */

import { execSync } from "node:child_process";
import path from "node:path";

export const WATCHER_DEBOUNCE_MS = 150;

export function resolveGitDir(cwd: string): string | null {
  try {
    const result = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return path.resolve(cwd, result.trim());
  } catch {
    return null;
  }
}
