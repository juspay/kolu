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

/** Returns null if the name is free, or a human-readable collision reason. */
function branchCollisionReason(
  mainRoot: string,
  branch: string,
): Promise<string | null> {
  const targetPath = path.join(mainRoot, ".worktrees", branch);
  if (fs.existsSync(targetPath)) {
    return Promise.resolve(`A worktree already exists at ${targetPath}`);
  }
  return simpleGit(mainRoot)
    .raw(["rev-parse", "--verify", `refs/heads/${branch}`])
    .then(() => `Branch "${branch}" already exists`)
    .catch(() => null);
}

/** Run `git worktree add` for a freshly-chosen branch name. */
async function runWorktreeAdd(
  mainRoot: string,
  branch: string,
  defaultBranch: string,
): Promise<{ path: string; branch: string }> {
  const targetPath = path.join(mainRoot, ".worktrees", branch);
  log.info(
    { mainRoot, targetPath, branch, base: `origin/${defaultBranch}` },
    "creating worktree",
  );
  await simpleGit(mainRoot).raw([
    "worktree",
    "add",
    targetPath,
    "-b",
    branch,
    `origin/${defaultBranch}`,
  ]);
  return { path: targetPath, branch };
}

/** Validate a user-supplied branch name.
 *  Rejects path-traversal (`..`) and restricts the character set to a
 *  safe subset of git's valid-ref grammar. The name must also not start
 *  with `.`, `-`, or `/` — these confuse `git branch` or `path.join`. */
function validateBranchName(name: string): string | null {
  if (name.length === 0) return "Branch name cannot be empty";
  if (name.includes("..")) return "Branch name cannot contain '..'";
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(name)) {
    return "Branch name must start with a letter, digit, or underscore, and contain only letters, digits, dots, slashes, dashes, underscores";
  }
  return null;
}

/** Generate a random, non-colliding worktree branch name. */
export async function worktreeSuggestName(repoPath: string): Promise<string> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  for (let attempt = 0; attempt < 5; attempt++) {
    const branch = randomName();
    if ((await branchCollisionReason(mainRoot, branch)) === null) return branch;
  }
  throw new Error("Failed to generate unique worktree name after 5 attempts");
}

/**
 * Create a git worktree, branching from origin/<default>.
 * If `branchName` is omitted, the server picks a random non-colliding name.
 * If provided, the name is validated and throws on collision (no retry).
 */
export async function worktreeCreate(
  repoPath: string,
  branchName?: string,
): Promise<{ path: string; branch: string }> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  const git = simpleGit(mainRoot);
  const wtLog = log.child({ mainRoot });

  wtLog.info("fetching origin");
  await git.fetch("origin");
  // Best-effort: update origin/HEAD to match remote's actual default branch.
  // Non-fatal — detectDefaultBranch has its own fallback chain.
  try {
    await git.remote(["set-head", "origin", "--auto"]);
  } catch (err) {
    wtLog.warn({ err }, "could not auto-detect origin HEAD, using fallback");
  }
  const defaultBranch = await detectDefaultBranch(mainRoot);

  // User-provided name: validate once, fail with a clear error on collision.
  if (branchName !== undefined) {
    const invalid = validateBranchName(branchName);
    if (invalid) throw new Error(invalid);
    const reason = await branchCollisionReason(mainRoot, branchName);
    if (reason) throw new Error(reason);
    return runWorktreeAdd(mainRoot, branchName, defaultBranch);
  }

  // No name provided: retry with fresh random names on collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const branch = randomName();
    if ((await branchCollisionReason(mainRoot, branch)) !== null) {
      wtLog.info({ branch }, "name collision, retrying");
      continue;
    }
    return runWorktreeAdd(mainRoot, branch, defaultBranch);
  }

  throw new Error("Failed to generate unique worktree name after 5 attempts");
}

/** Remove a git worktree by path and force-delete its branch. */
export async function worktreeRemove(worktreePath: string): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(worktreePath);
  const git = simpleGit(mainRoot);
  const wtLog = log.child({ mainRoot, worktreePath });

  // Detect the branch checked out in this worktree before removing it
  let branch: string | null = null;
  try {
    branch = (
      await simpleGit(worktreePath).raw(["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  } catch {
    // Worktree may already be partially removed
  }

  wtLog.info({ branch }, "removing worktree");
  await git.raw(["worktree", "remove", worktreePath, "--force"]);

  // Clean up the branch (force delete — these are ephemeral Kolu-created branches)
  if (branch && branch !== "HEAD") {
    try {
      await git.raw(["branch", "-D", branch]);
      wtLog.info({ branch }, "deleted worktree branch");
    } catch (err) {
      wtLog.warn({ branch, err }, "could not delete branch");
    }
  }
}
