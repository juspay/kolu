/** Shared constants and helpers for the live Code-view watcher layer.
 *
 *  `resolveGitDir` is the per-worktree gitDir lookup the three git-dir
 *  watchers (`watchGitHead`, `watchGitReflog`, `watchGitIndex`) share. For
 *  a regular repo it returns `<repoRoot>/.git`; for a *linked worktree* it
 *  returns `<main>/.git/worktrees/<name>` — the per-worktree git dir where
 *  `HEAD`, `index`, and `logs/` actually live (those are private to each
 *  worktree).
 *
 *  It is **async and bounded** on purpose. It runs a `git rev-parse`
 *  subprocess and a `realpath`; both must stay OFF the single Node event
 *  loop. An earlier synchronous `execSync` here parked the whole server in
 *  `waitpid` for 25 minutes on 2026-06-28 when a `git rev-parse` on the
 *  high-churn watcher-install path never returned. `execFile` keeps the
 *  loop live (the wait happens on a libuv thread), and `timeout` guarantees
 *  even a wedged child is reaped rather than leaked.
 *
 *  `WATCHER_DEBOUNCE_MS` is the trailing-edge debounce window every
 *  watcher and composed primitive in this layer uses. Tuned for editor
 *  save bursts and inotify multi-fire patterns; co-located here so a
 *  retune touches one constant. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { err, type GitResult, ok } from "./errors.ts";

const execFileAsync = promisify(execFile);

export const WATCHER_DEBOUNCE_MS = 150;

/** Hard ceiling on a git query a watcher install waits on (`git rev-parse`,
 *  `git config`). Both are near-instant on a healthy repo; this bound exists
 *  only so a wedged worktree filesystem or a stuck git child is killed and
 *  surfaces as "not resolvable" rather than hanging a watcher install. */
export const GIT_QUERY_TIMEOUT_MS = 5_000;

/** How long after an `unavailable` answer git is asked again. Nothing on
 *  disk says when a git that timed out answers again, so a spaced re-ask is
 *  the only trigger there is. */
export const UNAVAILABLE_REASK_MS = 3_000;

/** Resolve a `git rev-parse` git-dir flag to a canonical absolute path, or
 *  null when `cwd` isn't a repo (git fails or the bounded call is killed).
 *  Canonicalizes: macOS `/tmp` symlinks to `/private/tmp`, and `git
 *  rev-parse` reports a relative path from the repo root but a
 *  realpath-resolved absolute path from a subdir. Without realpath two
 *  subscribers reaching the same dir via different paths would key the
 *  shared-watcher registry under two strings and fail to dedupe. */
async function revParseDir(cwd: string, flag: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", flag], {
      cwd,
      encoding: "utf-8",
      timeout: GIT_QUERY_TIMEOUT_MS,
    });
    return await fs.promises.realpath(path.resolve(cwd, stdout.trim()));
  } catch {
    // Expected: not a git repo, git not installed, 5 s timeout (wedged child),
    // or realpath failure on a slow/hung mount — all mean "can't resolve git
    // dir" and the caller skips the watcher install silently.
    return null;
  }
}

/** Per-worktree git dir (`--git-dir`). In a linked worktree this is
 *  `.git/worktrees/<name>`, which holds the worktree-private `HEAD`,
 *  `index`, and `logs/` — the right target for those watchers. */
export function resolveGitDir(cwd: string): Promise<string | null> {
  return revParseDir(cwd, "--git-dir");
}

/** Shared (common) git dir (`--git-common-dir`). For a linked worktree this
 *  is the MAIN repo's `.git` — where the shared `config` (and thus the
 *  `origin` remote) lives, unlike the per-worktree `--git-dir`. The right
 *  target for watching remote-URL changes across all of a repo's worktrees. */
export function resolveGitCommonDir(cwd: string): Promise<string | null> {
  return revParseDir(cwd, "--git-common-dir");
}

/** Whether `cwd` is inside a working tree, by git's own answer to `git
 *  rev-parse --is-inside-work-tree`: `false` for a bare repo's folder (and
 *  anything under it that is not itself a worktree), `true` inside a checkout.
 *  A `GIT_FAILED` carrying git's message when git cannot answer — `cwd` is not
 *  a repo, git refuses it, git is missing, or the bounded call is killed — and
 *  when git answers anything but `true` or `false`. */
export async function isInsideWorkTree(
  cwd: string,
): Promise<GitResult<boolean>> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd, encoding: "utf-8", timeout: GIT_QUERY_TIMEOUT_MS },
    ));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({
      code: "GIT_FAILED",
      message: `Failed to tell whether the root has a working tree: ${msg}`,
    });
  }
  const answer = stdout.trim();
  if (answer === "true") return ok(true);
  if (answer === "false") return ok(false);
  return err({
    code: "GIT_FAILED",
    message: `git rev-parse --is-inside-work-tree answered ${JSON.stringify(answer)}`,
  });
}
