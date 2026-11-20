import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { type SimpleGit, simpleGit } from "simple-git";
import { err, type GitError, type GitResult, ok } from "./errors.ts";

async function resolveMainRepoRoot(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
  return path.dirname(fs.realpathSync(path.resolve(repoPath, gitCommonDir)));
}

/** The collision that stops a worktree being created at `.worktrees/<name>`,
 *  or `null` when the name is free. A previous removal deletes the directory
 *  but can leave the branch behind, so both are asked about. */
async function worktreeCollision(
  git: SimpleGit,
  targetPath: string,
  name: string,
): Promise<GitError | null> {
  if (fs.existsSync(targetPath)) {
    return {
      code: "WORKTREE_NAME_COLLISION",
      name,
      message: `A worktree directory already exists at ${targetPath}`,
    };
  }
  const ref = `refs/heads/${name}`;
  const heads = await git.raw(["for-each-ref", "--format=%(refname)", ref]);
  if (!heads.split("\n").some((line) => line.trim() === ref)) return null;
  return {
    code: "WORKTREE_NAME_COLLISION",
    name,
    message: `Branch '${name}' already exists`,
  };
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
 * Create a git worktree at `.worktrees/<name>` on a new branch `<name>`,
 * based on `origin/<default>`. Fails fast on collision; callers choose
 * how to recover.
 */
export async function worktreeCreate(
  repoPath: string,
  name: string,
  log?: Logger,
): Promise<GitResult<{ path: string; branch: string }>> {
  try {
    const mainRoot = await resolveMainRepoRoot(repoPath);
    const git = simpleGit(mainRoot);

    log?.info({ mainRoot }, "fetching origin");
    await git.fetch("origin");
    try {
      await git.remote(["set-head", "origin", "--auto"]);
    } catch (e) {
      log?.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "could not auto-detect origin HEAD, using fallback",
      );
    }
    const defaultBranch = await detectDefaultBranch(mainRoot);

    const targetPath = path.join(mainRoot, ".worktrees", name);

    const collision = await worktreeCollision(git, targetPath, name);
    if (collision) return err(collision);

    log?.info(
      { targetPath, branch: name, base: `origin/${defaultBranch}` },
      "creating worktree",
    );
    await git.raw([
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
): Promise<GitResult<void>> {
  try {
    const mainRoot = await resolveMainRepoRoot(worktreePath);
    const git = simpleGit(mainRoot);

    let branch: string | null = null;
    try {
      branch = (
        await simpleGit(worktreePath).raw(["rev-parse", "--abbrev-ref", "HEAD"])
      ).trim();
    } catch (e) {
      log?.warn(
        { worktreePath, err: e instanceof Error ? e.message : String(e) },
        "could not read the worktree's branch; removing without deleting it",
      );
    }

    log?.info({ mainRoot, worktreePath, branch }, "removing worktree");
    await git.raw(["worktree", "remove", worktreePath, "--force"]);

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
