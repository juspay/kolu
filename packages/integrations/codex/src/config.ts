import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_DIR_ENV = "KOLU_CODEX_DIR";
export const CODEX_DB_ENV = "KOLU_CODEX_DB";
export const CODEX_ENV_KEYS = [CODEX_DIR_ENV, CODEX_DB_ENV] as const;

/** Root of Codex's per-user state directory. Contains the threads
 *  SQLite DB, session JSONL rollouts, auth, and config. */
export const CODEX_DIR =
  process.env[CODEX_DIR_ENV] ?? path.join(os.homedir(), ".codex");

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
    const [, versionStr] = match as unknown as [string, string];
    const version = Number.parseInt(versionStr, 10);
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
  process.env[CODEX_DB_ENV] ??
  findCodexStateDbPath() ??
  path.join(CODEX_DIR, "state_5.sqlite");

/** Path to the SQLite WAL file — fs.watch this to detect writes.
 *  Codex appends to this WAL on every thread mutation, and atomically
 *  appends to the matching rollout JSONL in the same write cycle
 *  (verified: nanosecond-identical mtimes). So one signal covers both
 *  sources. */
export const CODEX_DB_WAL_PATH = `${CODEX_DB_PATH}-wal`;
