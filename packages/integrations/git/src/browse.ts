/** File tree browsing — git-filtered file listing and file reading.
 *
 *  Uses `git ls-files --cached --others --exclude-standard` to enumerate
 *  tracked + untracked-but-not-ignored paths in one shot. This avoids
 *  listing `node_modules/`, `.git/`, build artifacts, etc.
 *
 *  Side-effects route through a `GitExecutor` so the same code path
 *  works against the controller's local fs (default) and against a
 *  remote host via kolu-server's `Host` (which conforms to
 *  `GitExecutor` structurally). */

import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import { type GitExecutor, localExecutor } from "./executor.ts";
import { resolveUnder } from "./safe-path.ts";

/** Flat list of every repo-relative path (tracked + untracked-but-not-ignored).
 *  One-shot snapshot for Pierre's `@pierre/trees`, which builds the tree
 *  hierarchy itself from a flat path list. */
export async function listAll(
  repoPath: string,
  log?: Logger,
  executor: GitExecutor = localExecutor,
): Promise<GitResult<string[]>> {
  try {
    const result = await executor.exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: repoPath, maxBytes: 64 * 1024 * 1024 },
    );
    if (result.exitCode !== 0) {
      const msg = result.stderr.trim() || `git exited ${result.exitCode}`;
      log?.error(
        { repoPath, exitCode: result.exitCode },
        "git ls-files failed",
      );
      return err({
        code: "GIT_FAILED",
        message: `Failed to list files: ${msg}`,
      });
    }
    const paths = result.stdout.split("\n").filter((l) => l.length > 0);
    return ok(paths);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.error({ err: e, repoPath }, "git ls-files threw");
    return err({ code: "GIT_FAILED", message: `Failed to list files: ${msg}` });
  }
}

/** Max file size to read (1 MB). Larger files get a truncation notice. */
const MAX_READ_BYTES = 1_048_576;

/** Read a file's UTF-8 content, guarded against path traversal. */
export async function readFile(
  repoPath: string,
  filePath: string,
  log?: Logger,
  executor: GitExecutor = localExecutor,
): Promise<GitResult<{ content: string; truncated: boolean }>> {
  const resolved = resolveUnder(repoPath, filePath, log);
  if (!resolved.ok)
    return resolved as GitResult<{ content: string; truncated: boolean }>;
  try {
    const result = await executor.readFile(resolved.value.abs, {
      maxBytes: MAX_READ_BYTES,
    });
    return ok(result);
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
  executor: GitExecutor = localExecutor,
): Promise<GitResult<number>> {
  const resolved = resolveUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<number>;
  try {
    return ok(await executor.statMtimeMs(resolved.value.abs));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to stat file: ${msg}` });
  }
}
