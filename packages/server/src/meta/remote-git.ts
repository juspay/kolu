/**
 * Remote-host git metadata fetcher — replacement for `subscribeGitInfo`
 * when the terminal's PTY lives on a different machine. `kolu-git` shells
 * out via `execSync` against the controller's local fs, which can't see
 * remote paths like `/home/toor/code/kolu`, so for a remote terminal the
 * branch chip / worktree info silently never resolves.
 *
 * v0 trade-off: we poll via `host.exec` on cwd changes instead of watching
 * `.git/HEAD` (file watches over SSH are their own follow-up). Branch
 * updates land on every `cd` and on a periodic refresh (cheap — six
 * fixed `git rev-parse` invocations per refresh).
 */

import type { GitInfo } from "kolu-git/schemas";
import path from "node:path";
import type { Logger } from "../log.ts";
import type { Host } from "../host/types.ts";

/** How often we re-fetch git info while sitting in the same cwd. Picks
 *  up `git checkout` + `git branch` mutations the user did from inside
 *  the remote terminal without us watching .git/. Conservative — agent
 *  workflows that need real-time branch feedback will get it through
 *  cwd changes anyway. */
const POLL_INTERVAL_MS = 10_000;

/** Run a single `git` invocation through the host and return the
 *  trimmed stdout, or `null` on non-zero exit (which `git` uses to
 *  signal "not in a repo", "no HEAD yet", etc.). */
async function gitExec(
  host: Host,
  cwd: string,
  args: string[],
): Promise<string | null> {
  try {
    const result = await host.exec("git", args, {
      cwd,
      timeoutMs: 5_000,
      maxBytes: 65_536,
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

async function fetchGitInfo(host: Host, cwd: string): Promise<GitInfo | null> {
  // `--show-toplevel` is the cheapest "are we in a git repo" probe and
  // gives us the repoRoot in one shot. If it fails, we're not in a repo.
  const repoRoot = await gitExec(host, cwd, ["rev-parse", "--show-toplevel"]);
  if (!repoRoot) return null;

  // Parallelize the remaining lookups — they're independent and each
  // round-trip is dominated by SSH latency, not git execution time.
  const [branchRaw, gitCommonDir] = await Promise.all([
    gitExec(host, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitExec(host, cwd, ["rev-parse", "--git-common-dir"]),
  ]);

  const branch = branchRaw ?? "HEAD";
  const repoName = path.basename(repoRoot);

  // mainRepoRoot: for a worktree, `--git-common-dir` points at the
  // primary clone's `.git/` (absolute), so the parent of that is the
  // main repo root. For a non-worktree repo it returns `.git` (relative
  // to cwd) — we treat that as "not a worktree" and the mainRepoRoot
  // is the repoRoot itself.
  let mainRepoRoot = repoRoot;
  let isWorktree = false;
  if (gitCommonDir && path.isAbsolute(gitCommonDir)) {
    const candidate = path.dirname(gitCommonDir);
    if (candidate !== repoRoot) {
      mainRepoRoot = candidate;
      isWorktree = true;
    }
  }

  return {
    repoName,
    branch,
    repoRoot,
    worktreePath: repoRoot,
    isWorktree,
    mainRepoRoot,
  };
}

export interface RemoteGitWatcher {
  setCwd(cwd: string): void;
  stop(): void;
}

/** Start a remote-git fetcher for a single terminal. Invokes `onChange`
 *  with the current `GitInfo | null` on cwd changes and on the periodic
 *  poll. Returned handle's `stop()` clears the polling timer. */
export function startRemoteGit(
  host: Host,
  initialCwd: string,
  onChange: (git: GitInfo | null) => void,
  plog: Logger,
): RemoteGitWatcher {
  let cwd = initialCwd;
  let last: GitInfo | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh(): Promise<void> {
    try {
      const next = await fetchGitInfo(host, cwd);
      if (!gitInfoEqual(last, next)) {
        last = next;
        onChange(next);
        plog.debug(
          { repo: next?.repoName, branch: next?.branch },
          "remote git info updated",
        );
      }
    } catch (err) {
      plog.debug({ err }, "remote git fetch failed");
    }
  }

  function setCwd(nextCwd: string): void {
    if (nextCwd === cwd) return;
    cwd = nextCwd;
    void refresh();
  }

  function stop(): void {
    if (timer !== undefined) clearInterval(timer);
  }

  // Initial fetch + poll loop. The first fetch fires immediately so
  // the inspector populates as soon as the PTY's `~` resolves.
  void refresh();
  timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

  return { setCwd, stop };
}

function gitInfoEqual(a: GitInfo | null, b: GitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoName === b.repoName &&
    a.branch === b.branch &&
    a.repoRoot === b.repoRoot &&
    a.worktreePath === b.worktreePath &&
    a.isWorktree === b.isWorktree &&
    a.mainRepoRoot === b.mainRepoRoot
  );
}
