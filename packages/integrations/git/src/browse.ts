/** File tree browsing — git-filtered file listing and file reading.
 *
 *  Uses `git ls-files --cached --others --exclude-standard` to enumerate
 *  tracked + untracked-but-not-ignored paths in one shot, then subtracts
 *  `--deleted` so files removed from disk but still resident in the index
 *  don't appear as ghost rows in the tree. This avoids listing
 *  `node_modules/`, `.git/`, build artifacts, etc. */

import { execFile } from "node:child_process";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { promisify } from "node:util";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import { resolveUnder } from "./safe-path.ts";

const execFileAsync = promisify(execFile);

/** Flat list of every repo-relative path visible in the working tree
 *  (tracked + untracked-but-not-ignored, minus anything removed from
 *  disk). One-shot snapshot for Pierre's `@pierre/trees`, which builds
 *  the tree hierarchy itself from a flat path list.
 *
 *  `--cached` keeps an index entry alive after `rm <path>` until the
 *  deletion is staged, so subtracting `--deleted` (files present in the
 *  index but missing from the worktree) is what makes a plain `rm` show
 *  up as the file disappearing from the Code-tab tree on the next
 *  watcher tick. Without the subtraction, the pre- and post-rm path
 *  arrays are byte-identical and the upstream snapshot equality check
 *  suppresses the tick entirely — the row never disappears.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param log       Optional logger. */
export async function listAll(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  try {
    const opts = { cwd: repoPath, maxBuffer: 64 * 1024 * 1024 };
    const [{ stdout: allOut }, { stdout: deletedOut }] = await Promise.all([
      execFileAsync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        opts,
      ),
      execFileAsync("git", ["ls-files", "--deleted"], opts),
    ]);
    const deleted = new Set(deletedOut.split("\n").filter((l) => l.length > 0));
    const paths = allOut
      .split("\n")
      .filter((l) => l.length > 0 && !deleted.has(l));
    return ok(paths);
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

/** Stat a file's mtime in ms-since-epoch, used to cache-bust the iframe URL
 *  for binary previewable kinds. Same path-traversal guard as `readFile`. */
export async function statFileMtimeMs(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<number>> {
  const resolved = resolveUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<number>;
  try {
    const s = await fsStat(resolved.value.abs);
    return ok(s.mtimeMs);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to stat file: ${msg}` });
  }
}
