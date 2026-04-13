/** Directory listing with path traversal guard. */

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "kolu-integration-common";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface ListDirOptions {
  /** Absolute path to list. */
  path: string;
  /** Security root — requested path must resolve under this. */
  root: string;
  log?: Logger;
}

/**
 * List directory entries, sorted directories-first then alphabetical.
 *
 * Throws if the resolved path escapes the security root.
 */
export async function listDir(opts: ListDirOptions): Promise<DirEntry[]> {
  const resolved = path.resolve(opts.root, opts.path);

  // Path traversal guard: resolved path must be under root.
  if (resolved !== opts.root && !resolved.startsWith(opts.root + path.sep)) {
    throw new Error(`Path outside root: ${opts.path}`);
  }

  const dirents = await readdir(resolved, { withFileTypes: true });

  const entries = dirents
    .filter((d) => d.isDirectory() || d.isFile())
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      path: path.join(resolved, d.name),
    }));

  opts.log?.debug({ path: resolved, count: entries.length }, "fs.listDir");

  return entries;
}
