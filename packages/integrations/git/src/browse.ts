/** File tree browsing — git-filtered file listing and file reading.
 *
 *  Uses `git ls-files` to enumerate tracked files that still exist in the
 *  working tree plus untracked-but-not-ignored paths. This avoids listing
 *  `node_modules/`, `.git/`, build artifacts, etc. */

import { execFile } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { Logger } from "anyagent";
import { err, type GitResult, ok } from "./errors.ts";
import { resolveUnder } from "./safe-path.ts";

const execFileAsync = promisify(execFile);

function parseNulList(stdout: string): string[] {
  return stdout.split("\0").filter((l) => l.length > 0);
}

async function gitLsFiles(repoPath: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", ...args], {
    cwd: repoPath,
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseNulList(stdout);
}

/** Flat list of every repo-relative path present in the working tree
 *  (tracked + untracked-but-not-ignored).
 *  One-shot snapshot for Pierre's `@pierre/trees`, which builds the tree
 *  hierarchy itself from a flat path list.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param log       Optional logger. */
export async function listAll(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  try {
    const [paths, deleted] = await Promise.all([
      gitLsFiles(repoPath, ["--cached", "--others", "--exclude-standard"]),
      gitLsFiles(repoPath, ["--deleted"]),
    ]);
    const deletedSet = new Set(deleted);
    return ok(
      paths
        .filter((p) => !deletedSet.has(p))
        .sort((a, b) => a.localeCompare(b)),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.error({ err: e, repoPath }, "git ls-files failed");
    return err({ code: "GIT_FAILED", message: `Failed to list files: ${msg}` });
  }
}

/** Max file size to read (1 MB). Larger files get a truncation notice. */
const MAX_READ_BYTES = 1_048_576;

/** Read a file's UTF-8 content, guarded against path traversal.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param filePath  Path relative to repo root.
 *  @param log       Optional logger. */
export async function readFile(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<{ content: string; truncated: boolean }>> {
  const resolved = resolveUnder(repoPath, filePath, log);
  if (!resolved.ok)
    return resolved as GitResult<{ content: string; truncated: boolean }>;

  try {
    const buf = await fsReadFile(resolved.value.abs);
    if (buf.length > MAX_READ_BYTES) {
      // May split a multi-byte UTF-8 sequence at the boundary; Node
      // replaces the incomplete trailing character with U+FFFD.
      return ok({
        content: buf.subarray(0, MAX_READ_BYTES).toString("utf-8"),
        truncated: true,
      });
    }
    return ok({ content: buf.toString("utf-8"), truncated: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to read file: ${msg}` });
  }
}
