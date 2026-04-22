/** Configuration constants for the Codex integration.
 *  Leaf module — no imports from other package files. */

import path from "node:path";
import os from "node:os";

/** Root of Codex's per-user state directory. Contains the threads
 *  SQLite DB, session JSONL rollouts, auth, and config. */
export const CODEX_DIR =
  process.env.KOLU_CODEX_DIR ?? path.join(os.homedir(), ".codex");

/** Path to Codex's threads SQLite database. Configurable via env for
 *  testing. The `state_5` suffix is Codex's current schema version —
 *  upstream has bumped the number on incompatible schema changes
 *  (current is v5; `logs_2.sqlite` lives alongside at v2). If Codex
 *  ships a new major version with `state_6.sqlite`, this constant needs
 *  bumping — an intentional breakpoint rather than silently scanning
 *  every `state_*.sqlite` we find. */
export const CODEX_DB_PATH =
  process.env.KOLU_CODEX_DB ?? path.join(CODEX_DIR, "state_5.sqlite");

/** Path to the SQLite WAL file — fs.watch this to detect writes.
 *  Codex appends to this WAL on every thread mutation, and atomically
 *  appends to the matching rollout JSONL in the same write cycle
 *  (verified: nanosecond-identical mtimes). So one signal covers both
 *  sources. */
export const CODEX_DB_WAL_PATH = `${CODEX_DB_PATH}-wal`;
