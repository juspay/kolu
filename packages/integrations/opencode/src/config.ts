/** Configuration constants for the OpenCode integration.
 *  Leaf module — no imports from other package files. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Root of OpenCode's per-user data directory. Holds the SQLite DB(s). */
export const OPENCODE_DIR = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
);

/** Find the OpenCode SQLite DB under `dir`, most-recently-modified first.
 *
 *  OpenCode's DB filename is CHANNEL-SUFFIXED, not fixed: the stable release
 *  writes `opencode-stable.db`, a from-source/dev build writes
 *  `opencode-local.db`, and only the latest/beta/prod channels write the plain
 *  `opencode.db` (opencode's `database.ts` `path()`; `InstallationChannel`
 *  defaults to `local`). kolu used to hard-code `opencode.db`, so a current
 *  opencode's session was invisible — the bug this enumeration fixes. There is
 *  no version ordering across channels, so pick by mtime: whichever DB the user
 *  actually writes to is the freshest. Returns null if the dir is missing or has
 *  no matching file (the common case before opencode has ever run — the caller
 *  falls back to the current-default name so the WAL watcher still arms on the
 *  right path). Pure; exported for unit tests. */
export function findOpencodeDbPath(dir: string = OPENCODE_DIR): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let bestFile: string | null = null;
  let bestMtime = -1;
  for (const name of entries) {
    if (!/^opencode(-[A-Za-z0-9._-]+)?\.db$/.test(name)) continue;
    let mtime: number;
    try {
      mtime = fs.statSync(path.join(dir, name)).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      bestFile = name;
    }
  }
  return bestFile === null ? null : path.join(dir, bestFile);
}

/** Path to OpenCode's SQLite database. Env override wins (tests/e2e); then the
 *  enumeration; finally `opencode-stable.db` — the current release's default,
 *  so the WAL watcher arms on the right file even before opencode first runs. */
export const OPENCODE_DB_PATH =
  process.env.KOLU_OPENCODE_DB ??
  findOpencodeDbPath() ??
  path.join(OPENCODE_DIR, "opencode-stable.db");

/** Path to the SQLite WAL file — fs.watch this to detect writes. */
export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;
