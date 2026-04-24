/** File tree browsing — git-filtered directory listing and file reading.
 *
 *  Uses `git ls-tree` for tracked files and `git ls-files --others
 *  --exclude-standard` for untracked-but-not-ignored files. This
 *  avoids listing `node_modules/`, `.git/`, build artifacts, etc. */

import { readFile as fsReadFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "anyagent";
import { type GitResult, ok, err } from "./errors.ts";
import { resolveUnder } from "./safe-path.ts";

const execFileAsync = promisify(execFile);

export type DirEntry = {
  name: string;
  isDirectory: boolean;
  /** Path relative to repo root. */
  path: string;
};

/** List entries in a directory, filtered by git (tracked + untracked-but-not-ignored).
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param dirPath   Path relative to repo root (empty string for root).
 *  @param log       Optional logger. */
export async function listDir(
  repoPath: string,
  dirPath: string,
  log?: Logger,
): Promise<GitResult<DirEntry[]>> {
  // Validate path doesn't escape repo root.
  if (dirPath !== "") {
    const check = resolveUnder(repoPath, dirPath, log);
    if (!check.ok) return check as GitResult<DirEntry[]>;
  }

  const entries = new Map<string, DirEntry>();

  // 1. Tracked entries via `git ls-tree` (gives type info in one call).
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-tree", `HEAD:${dirPath}`],
      { cwd: repoPath },
    );
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      // Format: <mode> <type> <hash>\t<name>
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) continue;
      const name = line.slice(tabIdx + 1);
      const type = line.slice(0, tabIdx).split(" ")[1];
      const entryPath = dirPath ? `${dirPath}/${name}` : name;
      entries.set(name, {
        name,
        isDirectory: type === "tree",
        path: entryPath,
      });
    }
  } catch (e: unknown) {
    // ls-tree fails if HEAD doesn't exist (empty repo) or path doesn't exist
    // in HEAD — expected, we'll still get untracked files below.
    const msg = e instanceof Error ? e.message : String(e);
    const expected =
      msg.includes("Not a valid object name") || msg.includes("not a tree");
    if (!expected) {
      log?.error({ err: e, dirPath }, "ls-tree failed unexpectedly");
    }
  }

  // 2. Untracked-but-not-ignored entries in this directory.
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--directory",
        "--no-empty-directory",
        dirPath ? `${dirPath}/` : ".",
      ],
      { cwd: repoPath },
    );
    const prefix = dirPath ? `${dirPath}/` : "";
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      if (dirPath && !line.startsWith(prefix)) continue;
      const relative = dirPath ? line.slice(prefix.length) : line;
      // Immediate children only.
      const slashIdx = relative.indexOf("/");
      if (slashIdx === -1) {
        // File
        if (!entries.has(relative)) {
          entries.set(relative, {
            name: relative,
            isDirectory: false,
            path: line,
          });
        }
      } else if (slashIdx === relative.length - 1) {
        // Directory (trailing slash from --directory)
        const name = relative.slice(0, -1);
        if (!entries.has(name)) {
          const entryPath = dirPath ? `${dirPath}/${name}` : name;
          entries.set(name, { name, isDirectory: true, path: entryPath });
        }
      }
    }
  } catch (e: unknown) {
    log?.error({ err: e, dirPath }, "ls-files --others failed");
  }

  // Sort: directories first, then files, alphabetically.
  const sorted = [...entries.values()].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return ok(sorted);
}

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
