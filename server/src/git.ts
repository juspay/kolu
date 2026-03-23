/** Git context resolver — enriches CWD paths with repo/branch metadata. */

import path from "node:path";
import { simpleGit } from "simple-git";
import type { GitInfo, CwdInfo } from "kolu-common";

/** Build a CwdInfo by resolving git context for the given path. */
export async function toCwdInfo(cwd: string): Promise<CwdInfo> {
  return { cwd, git: await resolveGitInfo(cwd) };
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
