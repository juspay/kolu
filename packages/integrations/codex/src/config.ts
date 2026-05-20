/** Configuration constants for the Codex integration.
 *  Leaf module — no imports from other package files. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Executor, resolveExecutorHome } from "kolu-io";
import type { Logger } from "kolu-shared";

/** Root of Codex's per-user state directory. Contains the threads
 *  SQLite DB, session JSONL rollouts, auth, and config.
 *
 *  Controller-local constant — resolved against the host process's
 *  `$HOME` at module load. Executor-routed callers (the agent-provider
 *  path, which must work against remote SSH hosts too) should use
 *  `resolveCodexDirs(executor)` instead so the path is resolved against
 *  the executor's filesystem, not the controller's. Kept here as a
 *  back-compat export for `transcript.ts` (which only runs on local
 *  sessions) and for callers wired before the executor refactor. */
export const CODEX_DIR =
  process.env.KOLU_CODEX_DIR ?? path.join(os.homedir(), ".codex");

/** Paths to Codex's per-user state directory + threads DB on a specific
 *  executor's filesystem. `dir` is `<HOME>/.codex`; `dbPath` is the
 *  highest-numbered `state_v<N>.sqlite` (or `state_<N>.sqlite` — Codex
 *  has used both naming schemes) under it. Both can be null if `$HOME`
 *  is unreachable or if no state DB exists yet (fresh machine that has
 *  never run Codex). */
export interface CodexDirs {
  /** Absolute path to `<HOME>/.codex/`. */
  dir: string | null;
  /** Absolute path to the threads SQLite DB. */
  dbPath: string | null;
  /** Absolute path to the WAL sibling — used as the `executor.watch`
   *  target. Always `${dbPath}-wal` when `dbPath` is non-null. */
  walPath: string | null;
}

/** Resolve Codex's state-directory paths against an executor's
 *  filesystem. Uses `printenv HOME` to find `$HOME` on the executor (the
 *  controller and the executor may be different hosts with different
 *  home directories); then `ls` to enumerate state DB files.
 *
 *  All errors degrade silently to nulls — the caller treats a
 *  fully-null result as "Codex is not present on this executor," which
 *  is the same path a fresh local machine takes today. */
export async function resolveCodexDirs(
  executor: Executor,
  log?: Logger,
): Promise<CodexDirs> {
  // KOLU_CODEX_DB pins the DB path for tests + dev. When set, it wins
  // regardless of executor — preserving the legacy behavior of the
  // `CODEX_DB_PATH` constant below. The corresponding dir is still
  // resolved from $HOME so callers using `dir` for presence checks get
  // a sensible default.
  const home = await resolveExecutorHome(executor, log);
  const dir = home ? `${home}/.codex` : null;

  if (process.env.KOLU_CODEX_DB) {
    const dbPath = process.env.KOLU_CODEX_DB;
    return { dir, dbPath, walPath: `${dbPath}-wal` };
  }

  if (!dir) return { dir: null, dbPath: null, walPath: null };

  // Enumerate `state_v<N>.sqlite` / `state_<N>.sqlite` under `~/.codex/`
  // and pick the highest version. Codex bumps the suffix on
  // incompatible schema changes (v5 today); enumerating means a user
  // who upgrades past v5 doesn't silently lose detection. `ls | sort
  // -V | tail -n 1` is portable across GNU + BSD coreutils.
  let dbPath: string | null = null;
  try {
    const r = await executor.exec(
      "sh",
      [
        "-c",
        // The two glob patterns cover both naming schemes Codex has
        // shipped. `ls` returns nonzero when no files match either
        // pattern; the `|| true` suppresses that so the pipeline still
        // exits 0 and we read empty stdout below.
        'ls -1 "$HOME"/.codex/state_v*.sqlite "$HOME"/.codex/state_*.sqlite 2>/dev/null | sort -u | sort -V | tail -n 1 || true',
      ],
      { timeoutMs: 5_000 },
    );
    if (r.exitCode === 0) {
      const p = r.stdout.trim();
      if (p) dbPath = p;
    }
  } catch (err) {
    log?.debug({ err }, "resolveCodexDirs: state DB enumeration failed");
  }

  return {
    dir,
    dbPath,
    walPath: dbPath ? `${dbPath}-wal` : null,
  };
}

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
    // Group 1 is required by the pattern; the destructure with explicit
    // tuple type is the localized cast.
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
  process.env.KOLU_CODEX_DB ??
  findCodexStateDbPath() ??
  path.join(CODEX_DIR, "state_5.sqlite");

/** Path to the SQLite WAL file — fs.watch this to detect writes.
 *  Codex appends to this WAL on every thread mutation, and atomically
 *  appends to the matching rollout JSONL in the same write cycle
 *  (verified: nanosecond-identical mtimes). So one signal covers both
 *  sources. */
export const CODEX_DB_WAL_PATH = `${CODEX_DB_PATH}-wal`;
