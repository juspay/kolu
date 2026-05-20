/**
 * Git worktree operations — create and remove worktrees.
 * Worktrees are stored in `.worktrees/<name>` relative to the main repo root.
 */

import path from "node:path";
import { localExecutor, type Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import {
  gitOutput,
  pathExists,
  resolveMainRepoRoot,
} from "./executor-utils.ts";

/** Detect the default branch name on the remote (e.g. "main" or "master"). */
export async function detectDefaultBranch(
  repoPath: string,
  executor: Executor = localExecutor,
): Promise<string> {
  try {
    const ref = (
      await gitOutput(executor, repoPath, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    try {
      await gitOutput(executor, repoPath, [
        "rev-parse",
        "--verify",
        "origin/main",
      ]);
      return "main";
    } catch {
      return "master";
    }
  }
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
  executor: Executor = localExecutor,
): Promise<GitResult<{ path: string; branch: string }>> {
  try {
    const mainRoot = await resolveMainRepoRoot(executor, repoPath);

    log?.info({ mainRoot }, "fetching origin");
    await gitOutput(executor, mainRoot, ["fetch", "origin"]);
    // Best-effort: update origin/HEAD to match remote's actual default branch.
    // Non-fatal — detectDefaultBranch has its own fallback chain.
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

    const targetPath = path.join(mainRoot, ".worktrees", name);

    // Check for both directory and branch collision — a previous worktree
    // removal deletes the directory but leaves the branch behind.
    if (await pathExists(executor, targetPath)) {
      return err({
        code: "WORKTREE_NAME_COLLISION",
        name,
        message: `A worktree directory already exists at ${targetPath}`,
      });
    }
    try {
      await gitOutput(executor, mainRoot, [
        "rev-parse",
        "--verify",
        `refs/heads/${name}`,
      ]);
      return err({
        code: "WORKTREE_NAME_COLLISION",
        name,
        message: `Branch '${name}' already exists`,
      });
    } catch {
      // Branch doesn't exist — good
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
  executor: Executor = localExecutor,
): Promise<GitResult<void>> {
  try {
    const mainRoot = await resolveMainRepoRoot(executor, worktreePath);

    // Detect the branch checked out in this worktree before removing it
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

    // Clean up the branch (force delete — these are ephemeral Kolu-created branches)
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
