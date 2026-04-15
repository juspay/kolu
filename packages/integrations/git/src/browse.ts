/** Git-filtered directory listing.
 *
 *  Uses `git ls-tree` for tracked files and `git ls-files --others
 *  --exclude-standard` for untracked-but-not-ignored files. This
 *  avoids listing `node_modules/`, `.git/`, build artifacts, etc. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "anyagent";
import { type GitResult, ok } from "./errors.ts";
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
