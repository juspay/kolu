/**
 * Git info resolution: extracts repo remote URL and toplevel for a given CWD.
 * Caches by toplevel path (remote doesn't change within a session).
 */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { GitInfo } from "kolu-common";

const execFile = promisify(execFileCb);
const TIMEOUT_MS = 2000;

/** Cache: repo toplevel → formatted remote URL. */
const remoteCache = new Map<string, string>();

/** Run a git command in the given directory. Returns trimmed stdout or null on error. */
async function git(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["-C", cwd, ...args], {
      timeout: TIMEOUT_MS,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Format a git remote URL to "org/repo" form.
 * Handles SSH (`git@host:org/repo.git`) and HTTPS (`https://host/org/repo.git`).
 */
function formatRemoteUrl(url: string): string {
  // SSH: git@github.com:org/repo.git
  const sshMatch = url.match(/@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  // HTTPS: https://github.com/org/repo.git
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

/** Resolve git info for a CWD. Returns null if not in a git repo. */
export async function getGitInfo(cwd: string): Promise<GitInfo | null> {
  const toplevel = await git(cwd, "rev-parse", "--show-toplevel");
  if (!toplevel) return null;

  // Branch can change on every cd (e.g. worktree switch), always resolve
  const branch = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD");

  // Check cache by toplevel for remote (doesn't change within a session)
  const cached = remoteCache.get(toplevel);
  if (cached !== undefined) {
    return {
      remoteUrl: cached,
      branch: branch === "HEAD" ? null : branch,
      toplevel,
    };
  }

  const rawUrl = await git(cwd, "remote", "get-url", "origin");
  if (!rawUrl) return null;

  const remoteUrl = formatRemoteUrl(rawUrl);
  remoteCache.set(toplevel, remoteUrl);
  return { remoteUrl, branch: branch === "HEAD" ? null : branch, toplevel };
}
