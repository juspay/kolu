/** Configuration constants for the OpenCode integration.
 *  Leaf module — no imports from other package files (except types from
 *  kolu-io for the executor-aware resolver). */

import os from "node:os";
import path from "node:path";
import { type Executor, resolveExecutorHome } from "kolu-io";
import type { Logger } from "kolu-shared";

/** Path to OpenCode's SQLite database on the controller's local fs.
 *  Configurable via env for testing. Kept for backwards-compat with code
 *  paths that don't yet thread an executor (e.g. the one-shot transcript
 *  exporter). Executor-aware callers should resolve via
 *  {@link resolveOpenCodeDirs} instead. */
export const OPENCODE_DB_PATH =
  process.env.KOLU_OPENCODE_DB ??
  path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/** Path to the SQLite WAL file — fs.watch this to detect writes.
 *  Backwards-compat counterpart to {@link OPENCODE_DB_PATH}. */
export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;

/** Paths resolved against an executor's filesystem. The same shape on
 *  every backend: local terminals point at the controller's `$HOME`,
 *  remote ones at the SSH helper's. */
export interface OpenCodeDirs {
  /** Absolute path to `opencode.db` on the executor's fs. */
  dbPath: string;
  /** Absolute path to `opencode.db-wal` on the executor's fs. */
  walPath: string;
}

/**
 * Resolve OpenCode's data directory against an executor's filesystem.
 *
 * Local: short-circuits to {@link OPENCODE_DB_PATH} so the
 * `KOLU_OPENCODE_DB` env override keeps working (tests rely on it).
 * Otherwise: shells out `printenv HOME` on the executor and appends
 * `.local/share/opencode/opencode.db` — one RPC for remote backends,
 * a cheap fork for local.
 *
 * Returns null when HOME can't be resolved (printenv missing, empty
 * output, or a transport error). Callers fall back to "no opencode
 * here" — the user just doesn't see opencode state for that terminal,
 * not a hard failure.
 */
export async function resolveOpenCodeDirs(
  executor: Executor,
  log?: Logger,
): Promise<OpenCodeDirs | null> {
  // Local-side env override for testing — only takes effect when the
  // caller is using `localExecutor` (the controller's own fs). Remote
  // hosts get their own HOME via printenv below.
  if (process.env.KOLU_OPENCODE_DB) {
    const dbPath = process.env.KOLU_OPENCODE_DB;
    return { dbPath, walPath: `${dbPath}-wal` };
  }
  const home = await resolveExecutorHome(executor, log);
  if (!home) return null;
  const dbPath = `${home}/.local/share/opencode/opencode.db`;
  return { dbPath, walPath: `${dbPath}-wal` };
}
