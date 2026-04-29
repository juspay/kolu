/** Resolve a cwd to its `.git` directory (the path `git rev-parse --git-dir`
 *  reports), or `null` if the cwd isn't inside a git working tree. Used by
 *  the three git-dir-internal watchers (`watchGitHead`, `watchGitReflog`,
 *  `watchGitIndex`) so they share one lookup contract.
 *
 *  Returns an absolute path. For a regular repo this is `<repoRoot>/.git`;
 *  for worktrees it points back at the main repo's `.git` (which is where
 *  `HEAD`, `index`, and `logs/` actually live).
 *
 *  Synchronous on purpose — these watchers install once at subscribe time
 *  and the lookup is cheap. */

import { execSync } from "node:child_process";
import path from "node:path";

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
