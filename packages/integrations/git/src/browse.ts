/** File tree browsing — git-filtered file listing and file reading.
 *
 *  Uses `git ls-files --cached --others --exclude-standard` to enumerate
 *  tracked + untracked-but-not-ignored paths in one shot. This avoids
 *  listing `node_modules/`, `.git/`, build artifacts, etc. */

import { execFile } from "node:child_process";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { promisify } from "node:util";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import { resolveUnder } from "./safe-path.ts";

const execFileAsync = promisify(execFile);

/** Flat list of every repo-relative path (tracked + untracked-but-not-ignored).
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
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: repoPath, maxBuffer: 64 * 1024 * 1024 },
    );
    const paths = stdout.split("\n").filter((l) => l.length > 0);
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

/** Check whether a file exists on disk under `repoPath`, regardless of
 *  whether git tracks or ignores it. The fallback oracle for terminal
 *  file-ref clicks when `listAll` (which honors `.gitignore`) doesn't
 *  see the path. Same path-traversal guard as `readFile` — a `..` that
 *  escapes the root is rejected, not reported as `false`.
 *
 *  Returns `true` only for regular files. Directories return `false`
 *  because the click consumer (`CodeTab` preview) can't render them. */
export async function fsExists(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<boolean>> {
  const resolved = resolveUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<boolean>;
  try {
    const s = await fsStat(resolved.value.abs);
    return ok(s.isFile());
  } catch (e: unknown) {
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno === "ENOENT" || errno === "ENOTDIR") return ok(false);
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to stat file: ${msg}` });
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
