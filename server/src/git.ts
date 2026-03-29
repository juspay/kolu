/**
 * Git worktree operations — create and remove worktrees.
 * Worktrees are stored in `.worktrees/<name>` relative to the main repo root.
 */

import path from "node:path";
import fs from "node:fs";
import { simpleGit } from "simple-git";
import { log } from "./log.ts";
import { randomName } from "./randomName.ts";

/** Resolve the main repo root from any path inside a repo (including worktrees). */
async function resolveMainRepoRoot(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
  return path.dirname(fs.realpathSync(path.resolve(repoPath, gitCommonDir)));
}

/** Detect the default branch name on the remote (e.g. "main" or "master"). */
async function detectDefaultBranch(repoPath: string): Promise<string> {
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
): Promise<{ path: string; branch: string }> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  const git = simpleGit(mainRoot);
  const defaultBranch = await detectDefaultBranch(mainRoot);

  log.info({ mainRoot }, "fetching origin");
  await git.fetch("origin");

  for (let attempt = 0; attempt < 5; attempt++) {
    const branch = randomName();
    const targetPath = path.join(mainRoot, ".worktrees", branch);

    if (fs.existsSync(targetPath)) {
      log.info({ branch }, "name collision, retrying");
      continue;
    }

    log.info(
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

    return { path: targetPath, branch };
  }

  throw new Error("Failed to generate unique worktree name after 5 attempts");
}

/** Remove a git worktree by path. */
export async function worktreeRemove(worktreePath: string): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(worktreePath);
  const git = simpleGit(mainRoot);
  log.info({ worktreePath }, "removing worktree");
  await git.raw(["worktree", "remove", worktreePath, "--force"]);
}
