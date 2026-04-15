/**
 * Git worktree operations — create and remove worktrees.
 * Worktrees are stored in `.worktrees/<name>` relative to the main repo root.
 */

import path from "node:path";
import fs from "node:fs";
import { simpleGit } from "simple-git";
import type { Logger } from "anyagent";
import { type GitResult, ok, err } from "./errors.ts";
import { randomName } from "memorable-names";

/** Resolve the main repo root from any path inside a repo (including worktrees). */
async function resolveMainRepoRoot(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
  return path.dirname(fs.realpathSync(path.resolve(repoPath, gitCommonDir)));
}

/** Detect the default branch name on the remote (e.g. "main" or "master"). */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    const ref = (
      await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    try {
      await git.raw(["rev-parse", "--verify", "origin/main"]);
      return "main";
    } catch {
      return "master";
    }
  }
}

/**
 * Create a git worktree with a random name, branching from origin/<default>.
 * Retries with a new name on collision.
 */
export async function worktreeCreate(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<{ path: string; branch: string }>> {
  try {
    const mainRoot = await resolveMainRepoRoot(repoPath);
    const git = simpleGit(mainRoot);

    log?.info({ mainRoot }, "fetching origin");
    await git.fetch("origin");
    // Best-effort: update origin/HEAD to match remote's actual default branch.
    // Non-fatal — detectDefaultBranch has its own fallback chain.
    try {
      await git.remote(["set-head", "origin", "--auto"]);
    } catch (e) {
      log?.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "could not auto-detect origin HEAD, using fallback",
      );
    }
    const defaultBranch = await detectDefaultBranch(mainRoot);

    for (let attempt = 0; attempt < 5; attempt++) {
      const branch = randomName();
      const targetPath = path.join(mainRoot, ".worktrees", branch);

      // Check for both directory and branch name collision — a previous worktree
      // removal deletes the directory but leaves the branch behind.
      if (fs.existsSync(targetPath)) {
        log?.info({ branch }, "path collision, retrying");
        continue;
      }
      try {
        await git.raw(["rev-parse", "--verify", `refs/heads/${branch}`]);
        log?.info({ branch }, "branch collision, retrying");
        continue;
      } catch {
        // Branch doesn't exist — good
      }

      log?.info(
        { targetPath, branch, base: `origin/${defaultBranch}` },
        "creating worktree",
      );
      await git.raw([
        "worktree",
        "add",
        targetPath,
        "-b",
        branch,
        `origin/${defaultBranch}`,
      ]);

      return ok({ path: targetPath, branch });
    }

    return err({
      code: "WORKTREE_NAME_EXHAUSTED",
      message: "Failed to generate unique worktree name after 5 attempts",
    });
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
): Promise<GitResult<void>> {
  try {
    const mainRoot = await resolveMainRepoRoot(worktreePath);
    const git = simpleGit(mainRoot);

    // Detect the branch checked out in this worktree before removing it
    let branch: string | null = null;
    try {
      branch = (
        await simpleGit(worktreePath).raw(["rev-parse", "--abbrev-ref", "HEAD"])
      ).trim();
    } catch {
      // Worktree may already be partially removed
    }

    log?.info({ mainRoot, worktreePath, branch }, "removing worktree");
    await git.raw(["worktree", "remove", worktreePath, "--force"]);

    // Clean up the branch (force delete — these are ephemeral Kolu-created branches)
    if (branch && branch !== "HEAD") {
      try {
        await git.raw(["branch", "-D", branch]);
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
