/** Git context resolver — enriches CWD paths with repo/branch metadata. */

import path from "node:path";
import { simpleGit } from "simple-git";
import type { GitInfo, CwdInfo, WorktreeEntry } from "kolu-common";

/** Build a CwdInfo by resolving git context for the given path. */
export async function toCwdInfo(cwd: string): Promise<CwdInfo> {
  return { cwd, git: await resolveGitInfo(cwd) };
}

/** List worktrees for a git repo. Parses `git worktree list --porcelain`. */
export async function listWorktrees(
  repoRoot: string,
): Promise<WorktreeEntry[]> {
  const git = simpleGit(repoRoot);
  const raw = await git.raw(["worktree", "list", "--porcelain"]);
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), isBare: false };
    } else if (line === "bare") {
      current.isBare = true;
    } else if (line.startsWith("branch ")) {
      // "branch refs/heads/main" → "main"
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "") {
      if (current.path) {
        entries.push({
          path: current.path,
          branch: current.branch ?? null,
          isBare: current.isBare ?? false,
        });
      }
      current = {};
    }
  }
  return entries;
}

/** Resolve git context for a directory. Returns null if not in a git repo. */
async function resolveGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const git = simpleGit(cwd);
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    // symbolic-ref works in both normal and empty repos (no commits yet).
    // Falls back to rev-parse for detached HEAD (returns commit-ish).
    let branch: string;
    try {
      branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    } catch {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    }
    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      worktreePath: cwd,
      branch,
    };
  } catch {
    return null;
  }
}
