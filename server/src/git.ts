/** Git context resolver — enriches CWD paths with repo/branch metadata. */

import path from "node:path";
import { simpleGit } from "simple-git";
import type { GitInfo } from "kolu-common";

/** Resolve git context for a directory. Returns null if not in a git repo. */
export async function resolveGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const git = simpleGit(cwd);
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    // rev-parse --abbrev-ref HEAD fails in empty repos (no commits),
    // so fall back to symbolic-ref which reads HEAD directly.
    let branch: string;
    try {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    } catch {
      branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
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
