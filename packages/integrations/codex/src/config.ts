/** Configuration constants for the Codex integration.
 *  Leaf module — no imports from other package files. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unwrap } from "anyagent/unwrap";

/** Root of Codex's per-user state directory. Contains the threads
 *  SQLite DB, session JSONL rollouts, auth, and config. */
export const CODEX_DIR =
  process.env.KOLU_CODEX_DIR ?? path.join(os.homedir(), ".codex");

/** Find the highest-numbered `state_<N>.sqlite` under `dir`. Codex bumps
 *  this suffix on incompatible schema changes (current is v5;
 *  `logs_2.sqlite` lives alongside at v2). Enumerating instead of
 *  hard-coding the version means a user who upgrades Codex past v5
 *  doesn't silently lose session detection until Kolu ships an update.
 *
 *  Returns null if the directory is missing or contains no matching
 *  files — the caller falls back to the legacy path so the rest of the
 *  stack behaves the same as before (ENOENT → graceful skip). Pure; no
 *  logging here since there's no Logger at module-load time.
 *
 *  Exported for unit tests; production callers use `CODEX_DB_PATH`. */
export function findCodexStateDbPath(dir: string = CODEX_DIR): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let bestVersion = -1;
  let bestFile: string | null = null;
  for (const name of entries) {
    const match = /^state_(\d+)\.sqlite$/.exec(name);
    if (!match) continue;
    // Group 1 is required by the pattern itself — `unwrap` documents that
    // invariant at the throw site rather than papering over it with `!`.
    const version = Number.parseInt(
      unwrap(match[1], `state_(\\d+).sqlite regex shape changed for ${name}`),
      10,
    );
    if (version > bestVersion) {
      bestVersion = version;
      bestFile = name;
    }
  }
  return bestFile === null ? null : path.join(dir, bestFile);
}

/** Path to Codex's threads SQLite database. Env override wins; then the
 *  enumeration; finally the legacy `state_5.sqlite` fallback for hosts
 *  that don't have Codex installed yet (preserves the old ENOENT-silent
 *  behavior in `openDb`). */
export const CODEX_DB_PATH =
  process.env.KOLU_CODEX_DB ??
  findCodexStateDbPath() ??
  path.join(CODEX_DIR, "state_5.sqlite");

/** Path to the SQLite WAL file — fs.watch this to detect writes.
 *  Codex appends to this WAL on every thread mutation, and atomically
 *  appends to the matching rollout JSONL in the same write cycle
 *  (verified: nanosecond-identical mtimes). So one signal covers both
 *  sources. */
export const CODEX_DB_WAL_PATH = `${CODEX_DB_PATH}-wal`;
