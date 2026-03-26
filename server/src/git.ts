/** Git context resolver — enriches CWD paths with repo/branch metadata. */

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import type { GitInfo, CwdInfo } from "kolu-common";
import { log } from "./log.ts";

/** Build a CwdInfo by resolving git context for the given path. */
export async function toCwdInfo(cwd: string): Promise<CwdInfo> {
  return { cwd, git: await resolveGitInfo(cwd) };
}

const DEBOUNCE_MS = 150;

/**
 * Watch .git/HEAD for changes (branch switches, checkout, etc.).
 * Calls `onChange` when HEAD changes. Returns a cleanup function.
 * Returns a no-op cleanup for non-git directories.
 */
export function watchGitHead(cwd: string, onChange: () => void): () => void {
  let gitDir: string;
  try {
    // --git-dir resolves correctly for worktrees too
    const result = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitDir = path.resolve(cwd, result.trim());
  } catch {
    return () => {}; // not a git repo
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(gitDir, (_, filename) => {
      if (filename !== "HEAD") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, DEBOUNCE_MS);
    });
  } catch (err) {
    log.debug({ err, gitDir }, "failed to watch git dir");
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
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
