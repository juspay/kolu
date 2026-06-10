/** Shared constants and helpers for the live Code-view watcher layer.
 *
 *  `resolveGitDir` is the per-worktree gitDir lookup the three git-dir
 *  watchers (`watchGitHead`, `watchGitReflog`, `watchGitIndex`) share. For
 *  a regular repo it returns `<repoRoot>/.git`; for a *linked worktree* it
 *  returns `<main>/.git/worktrees/<name>` — the per-worktree git dir where
 *  `HEAD`, `index`, and `logs/` actually live (those are private to each
 *  worktree).
 *
 *  `resolveGitCommonDir` is the *common* gitDir lookup (`--git-common-dir`).
 *  It coincides with `resolveGitDir` in a regular repo, but in a linked
 *  worktree it points back at the main repo's `.git` — where `config` (and
 *  thus `remote.origin.url`) lives, shared across every worktree. The config
 *  watcher keys off this so `git remote set-url` is caught from inside a
 *  worktree too; HEAD/index/reflog stay on the per-worktree `resolveGitDir`.
 *
 *  Both are synchronous because watchers install once at subscribe time.
 *
 *  `WATCHER_DEBOUNCE_MS` is the trailing-edge debounce window every
 *  watcher and composed primitive in this layer uses. Tuned for editor
 *  save bursts and inotify multi-fire patterns; co-located here so a
 *  retune touches one constant. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const WATCHER_DEBOUNCE_MS = 150;

/** Resolve a `git rev-parse` git-dir flag to a canonical absolute path, or
 *  null when `cwd` isn't a repo (or git fails). Canonicalizes: macOS `/tmp`
 *  symlinks to `/private/tmp`, and `git rev-parse` reports a relative path
 *  from the repo root but a realpath-resolved absolute path from a subdir.
 *  Without realpath two subscribers reaching the same dir via different
 *  paths would key the shared-watcher registry under two strings and fail
 *  to dedupe. */
function revParseDir(cwd: string, flag: string): string | null {
  try {
    const result = execSync(`git rev-parse ${flag}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return fs.realpathSync(path.resolve(cwd, result.trim()));
  } catch {
    return null;
  }
}

/** Per-worktree git dir (`--git-dir`). In a linked worktree this is
 *  `.git/worktrees/<name>`, which holds the worktree-private `HEAD`,
 *  `index`, and `logs/` — the right target for those watchers. */
export function resolveGitDir(cwd: string): string | null {
  return revParseDir(cwd, "--git-dir");
}

/** Common git dir (`--git-common-dir`). Equals `resolveGitDir` in a normal
 *  repo; in a linked worktree it points back at the main repo's `.git`,
 *  where `config` (and `remote.origin.url`) lives. The config watcher uses
 *  this so a remote change is caught from inside a worktree. */
export function resolveGitCommonDir(cwd: string): string | null {
  return revParseDir(cwd, "--git-common-dir");
}
