import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  open as fsOpen,
  readFile as fsReadFile,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Logger } from "kolu-shared";
import pLimit from "p-limit";
import { err, type GitResult, isFileGoneError, ok } from "./errors.ts";
import { resolveExistingUnder } from "./safe-path.ts";
import { MAX_READ_BYTES } from "./schemas.ts";

const execFileAsync = promisify(execFile);

/** Single spawn/parse/error path shared by the two `git ls-files` listings.
 *  `-z` is load-bearing: without it git C-quotes and double-quote-wraps
 *  "unusual" path bytes per `core.quotePath`, so `People/Amélie.md` arrives as
 *  `"People/Am\303\251lie.md"`. */
async function gitLsFiles(
  repoPath: string,
  selectionArgs: string[],
  failMsg: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", ...selectionArgs],
      {
        cwd: repoPath,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const paths = stdout.split("\0").filter((l) => l.length > 0);
    return ok(paths);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.error({ err: msg, repoPath }, "git ls-files failed");
    return err({ code: "GIT_FAILED", message: `${failMsg}: ${msg}` });
  }
}

/** Flat list of every repo-relative path (tracked + untracked-but-not-ignored). */
export async function listAll(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  return gitLsFiles(
    repoPath,
    ["--cached", "--others", "--exclude-standard"],
    "Failed to list files",
    log,
  );
}

/** Repo-relative entries git *ignores* — the exact complement of `listAll`.
 *  `--directory` collapses a fully-ignored directory to its name, keeping git's
 *  trailing slash. Does NOT list `.git`: git never reports its own dir. */
export async function listIgnored(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  return gitLsFiles(
    repoPath,
    ["--others", "--ignored", "--exclude-standard", "--directory"],
    "Failed to list ignored files",
    log,
  );
}

/** Sized just above libuv's default 4-thread filesystem pool. */
const STAT_CONCURRENCY = 8;

/** Which of `names` (resolved under `abs`) are symlinks to a directory, at most
 *  `STAT_CONCURRENCY` stats in flight. A broken link is not a directory; every
 *  other stat failure fails the whole listing. */
async function directoryLinks(
  abs: string,
  names: readonly string[],
): Promise<Set<string>> {
  const limit = pLimit(STAT_CONCURRENCY);
  const directories = new Set<string>();
  await limit.map(names, async (name) => {
    try {
      if ((await stat(path.join(abs, name))).isDirectory()) {
        directories.add(name);
      }
    } catch (e: unknown) {
      if (!isFileGoneError(e)) throw e;
    }
  });
  return directories;
}

/** ONE level of a directory's contents, repo-relative, with git's trailing
 *  slash on each subdirectory — the folder-key format `listIgnored` emits. A
 *  missing or unreadable directory returns an err, never an empty list. */
export async function listDirectory(
  repoPath: string,
  dirPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  const resolved = await resolveExistingUnder(repoPath, dirPath, log);
  if (!resolved.ok) return resolved as GitResult<string[]>;
  const { abs, rel } = resolved.value;
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    const linkNames = entries
      .filter((e) => !e.isDirectory() && e.isSymbolicLink())
      .map((e) => e.name);
    const linkedDirectories = await directoryLinks(abs, linkNames);
    const rows = entries.map((e) => {
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      // `withFileTypes` has `lstat` semantics, so a symlink reports
      // `isDirectory() === false`; `stat` answers from the target.
      return e.isDirectory() || linkedDirectories.has(e.name)
        ? `${child}/`
        : child;
    });
    return ok(rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isFileGoneError(e)) {
      log?.debug({ err: msg, repoPath, dirPath }, "listDirectory: dir gone");
      return err({ code: "FILE_GONE", path: dirPath, message: msg });
    }
    log?.error({ err: msg, repoPath, dirPath }, "listDirectory failed");
    return err({
      code: "GIT_FAILED",
      message: `Failed to list directory: ${msg}`,
    });
  }
}

/** Read a file's UTF-8 content, guarded against path traversal. */
export async function readFile(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<{ content: string; truncated: boolean }>> {
  const resolved = await resolveExistingUnder(repoPath, filePath, log);
  if (!resolved.ok)
    return resolved as GitResult<{ content: string; truncated: boolean }>;

  try {
    const buf = await fsReadFile(resolved.value.abs);
    if (buf.length > MAX_READ_BYTES) {
      // Node replaces a split multi-byte UTF-8 sequence with U+FFFD.
      return ok({
        content: buf.subarray(0, MAX_READ_BYTES).toString("utf-8"),
        truncated: true,
      });
    }
    return ok({ content: buf.toString("utf-8"), truncated: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isFileGoneError(e))
      return err({ code: "FILE_GONE", path: filePath, message: msg });
    return err({ code: "GIT_FAILED", message: `Failed to read file: ${msg}` });
  }
}

/** A cache-buster TAG for the iframe preview URL (the `?v=<tag>` on the binary
 *  route): it changes iff the file's bytes change, so an identical-content
 *  rewrite leaves a mid-scrolled preview alone. Hashes the WHOLE file, streamed
 *  through one open handle, and aborts promptly when `signal` fires. */
export async function filePreviewTag(
  repoPath: string,
  filePath: string,
  log?: Logger,
  signal?: AbortSignal,
): Promise<GitResult<string>> {
  const resolved = await resolveExistingUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<string>;
  const abs = resolved.value.abs;
  try {
    signal?.throwIfAborted();
    const hash = createHash("sha1");
    // `autoClose: false` so the `finally` owns the close even when an abort
    // throws out of the loop mid-read.
    const fh = await fsOpen(abs, "r");
    try {
      for await (const chunk of fh.createReadStream({ autoClose: false })) {
        signal?.throwIfAborted();
        hash.update(chunk as Buffer);
      }
    } finally {
      await fh.close().catch(() => {});
    }
    return ok(hash.digest("hex"));
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (isFileGoneError(e)) {
      log?.debug({ err: msg, repoPath, filePath }, "preview-tag file gone");
      return err({ code: "FILE_GONE", path: filePath, message: msg });
    }
    log?.error({ err: msg, repoPath, filePath }, "preview-tag hash failed");
    return err({ code: "GIT_FAILED", message: `Failed to hash file: ${msg}` });
  }
}
