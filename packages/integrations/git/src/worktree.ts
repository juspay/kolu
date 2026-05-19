/**
 * Git worktree operations — create and remove worktrees.
 *
 * Routes every IO through a `GitExecutor` so the same body runs against
 * the controller's local fs (`localExecutor`) and a remote SSH host
 * (`Host`). Two backends, one implementation.
 *
 * Worktrees are stored in `.worktrees/<name>` relative to the main repo
 * root on whichever fs the executor speaks for.
 */

import path from "node:path";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import { type GitExecutor, localExecutor } from "./executor.ts";

/** Run a git invocation through the executor; throw on non-zero exit so
 *  the outer try/catch packages the error into a `GitResult`. */
async function gitOutput(
  executor: GitExecutor,
  cwd: string,
  args: string[],
): Promise<string> {
  const result = await executor.exec("git", args, {
    cwd,
    maxBytes: 64 * 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `git exited ${result.exitCode}`);
  }
  return result.stdout;
}

/** True if the given path exists on the executor's fs. Uses `statMtimeMs`
 *  as a lightweight existence probe — any error (ENOENT, EACCES) returns
 *  false. Matches the cwd existence checks the worktree code used to do
 *  with `fs.existsSync` locally. */
async function pathExists(executor: GitExecutor, p: string): Promise<boolean> {
  try {
    await executor.statMtimeMs(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the main repo root from any path inside a repo (including
 *  worktrees). `git rev-parse --git-common-dir` returns the shared `.git/`
 *  on a worktree; its parent is the main repo root. */
async function resolveMainRepoRoot(
  executor: GitExecutor,
  repoPath: string,
): Promise<string> {
  const commonDir = (
    await gitOutput(executor, repoPath, ["rev-parse", "--git-common-dir"])
  ).trim();
  // Resolve to an absolute path on the executor's fs. `git` may return
  // either an absolute path (worktrees on the main repo's path) or a
  // relative path (worktrees inside their own `.git`). Use the executor's
  // shell to canonicalize — `readlink -f` is portable across GNU + BSD
  // coreutils and runs on whichever side the path lives on.
  const abs = path.isAbsolute(commonDir)
    ? commonDir
    : path.resolve(repoPath, commonDir);
  const realResult = await executor.exec("readlink", ["-f", abs], {
    timeoutMs: 5_000,
  });
  const realPath = realResult.exitCode === 0 ? realResult.stdout.trim() : abs;
  return path.dirname(realPath);
}

/** Detect the default branch name on the remote (e.g. "main" or "master"). */
export async function detectDefaultBranch(
  repoPath: string,
  executor: GitExecutor = localExecutor,
): Promise<string> {
  const symRef = await executor.exec(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    { cwd: repoPath },
  );
  if (symRef.exitCode === 0) {
    return symRef.stdout.trim().replace("refs/remotes/origin/", "");
  }
  const verifyMain = await executor.exec(
    "git",
    ["rev-parse", "--verify", "origin/main"],
    { cwd: repoPath },
  );
  if (verifyMain.exitCode === 0) return "main";
  return "master";
}

/**
 * Create a git worktree at `.worktrees/<name>` on a new branch `<name>`,
 * based on `origin/<default>`. Fails fast on collision; callers choose
 * how to recover.
 */
export async function worktreeCreate(
  repoPath: string,
  name: string,
  log?: Logger,
  executor: GitExecutor = localExecutor,
): Promise<GitResult<{ path: string; branch: string }>> {
  try {
    const mainRoot = await resolveMainRepoRoot(executor, repoPath);

    log?.info({ mainRoot }, "fetching origin");
    await gitOutput(executor, mainRoot, ["fetch", "origin"]);
    // Best-effort: update origin/HEAD to match remote's actual default
    // branch. Non-fatal — detectDefaultBranch has its own fallback chain.
    try {
      await gitOutput(executor, mainRoot, [
        "remote",
        "set-head",
        "origin",
        "--auto",
      ]);
    } catch (e) {
      log?.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "could not auto-detect origin HEAD, using fallback",
      );
    }
    const defaultBranch = await detectDefaultBranch(mainRoot, executor);

    const targetPath = path.posix.join(mainRoot, ".worktrees", name);

    // Check for both directory and branch collision — a previous worktree
    // removal deletes the directory but leaves the branch behind.
    if (await pathExists(executor, targetPath)) {
      return err({
        code: "WORKTREE_NAME_COLLISION",
        name,
        message: `A worktree directory already exists at ${targetPath}`,
      });
    }
    const branchVerify = await executor.exec(
      "git",
      ["rev-parse", "--verify", `refs/heads/${name}`],
      { cwd: mainRoot },
    );
    if (branchVerify.exitCode === 0) {
      return err({
        code: "WORKTREE_NAME_COLLISION",
        name,
        message: `Branch '${name}' already exists`,
      });
    }

    log?.info(
      { targetPath, branch: name, base: `origin/${defaultBranch}` },
      "creating worktree",
    );
    await gitOutput(executor, mainRoot, [
      "worktree",
      "add",
      targetPath,
      "-b",
      name,
      `origin/${defaultBranch}`,
    ]);

    return ok({ path: targetPath, branch: name });
  } catch (e) {
    return err({
      code: "GIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Remove a git worktree by path and force-delete its branch. */
export async function worktreeRemove(
  worktreePath: string,
  log?: Logger,
  executor: GitExecutor = localExecutor,
): Promise<GitResult<void>> {
  try {
    const mainRoot = await resolveMainRepoRoot(executor, worktreePath);

    // Detect the branch checked out in this worktree before removing it.
    let branch: string | null = null;
    try {
      branch = (
        await gitOutput(executor, worktreePath, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ])
      ).trim();
    } catch {
      // Worktree may already be partially removed
    }

    log?.info({ mainRoot, worktreePath, branch }, "removing worktree");
    await gitOutput(executor, mainRoot, [
      "worktree",
      "remove",
      worktreePath,
      "--force",
    ]);

    // Clean up the branch (force delete — these are ephemeral Kolu-created
    // branches).
    if (branch && branch !== "HEAD") {
      try {
        await gitOutput(executor, mainRoot, ["branch", "-D", branch]);
        log?.info({ branch }, "deleted worktree branch");
      } catch (e) {
        log?.warn(
          { branch, err: e instanceof Error ? e.message : String(e) },
          "could not delete branch",
        );
      }
    }

    return ok(undefined);
  } catch (e) {
    return err({
      code: "GIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
