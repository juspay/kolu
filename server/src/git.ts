/**
 * Git worktree operations — create, remove, and list worktrees.
 *
 * Worktrees are stored in `.worktrees/<branch>` relative to the main repo root.
 * Branch names are sanitized for use as directory names (slashes → dashes).
 */

import path from "node:path";
import fs from "node:fs";
import { simpleGit } from "simple-git";
import type { WorktreeEntry } from "kolu-common";
import { log } from "./log.ts";

/** Sanitize a branch name for use as a directory name. */
function sanitizeBranch(branch: string): string {
  return branch.replace(/\//g, "-");
}

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
    // refs/remotes/origin/main → main
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // Fallback: try common names
    try {
      await git.raw(["rev-parse", "--verify", "origin/main"]);
      return "main";
    } catch {
      return "master";
    }
  }
}

/**
 * Create a git worktree at `.worktrees/<sanitized-branch>` with a new branch
 * based on `origin/<default-branch>`.
 */
export async function worktreeCreate(
  repoPath: string,
  branch: string,
): Promise<{ path: string; branch: string; isNew: boolean }> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  const sanitized = sanitizeBranch(branch);
  const targetPath = path.join(mainRoot, ".worktrees", sanitized);

  // If worktree already exists at this path, return it
  if (fs.existsSync(targetPath)) {
    log.info({ path: targetPath, branch }, "worktree already exists");
    return { path: targetPath, branch, isNew: false };
  }

  const git = simpleGit(mainRoot);
  const defaultBranch = await detectDefaultBranch(mainRoot);

  // Fetch latest from origin
  log.info({ mainRoot }, "fetching origin");
  await git.fetch("origin");

  // Create worktree with new branch from origin/<default>
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

  return { path: targetPath, branch, isNew: true };
}

/** Remove a git worktree by path. */
export async function worktreeRemove(worktreePath: string): Promise<void> {
  // Resolve which repo this worktree belongs to
  const mainRoot = await resolveMainRepoRoot(worktreePath);
  const git = simpleGit(mainRoot);
  log.info({ worktreePath }, "removing worktree");
  await git.raw(["worktree", "remove", worktreePath, "--force"]);
}

/** List all worktrees for a repo, excluding the main worktree. */
export async function worktreeList(repoPath: string): Promise<WorktreeEntry[]> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  const git = simpleGit(mainRoot);
  const output = (await git.raw(["worktree", "list", "--porcelain"])).trim();
  if (!output) return [];

  const entries: WorktreeEntry[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      // Start of a new entry — flush previous
      if (currentPath !== null && currentPath !== mainRoot) {
        entries.push({ path: currentPath, branch: currentBranch });
      }
      currentPath = line.slice("worktree ".length);
      currentBranch = null;
    } else if (line.startsWith("branch ")) {
      // refs/heads/foo → foo
      currentBranch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  // Flush last entry
  if (currentPath !== null && currentPath !== mainRoot) {
    entries.push({ path: currentPath, branch: currentBranch });
  }

  return entries;
}
