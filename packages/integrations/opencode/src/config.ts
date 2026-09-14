/** Configuration constants for the OpenCode integration.
 *  Leaf module — no imports from other package files. */

import os from "node:os";
import path from "node:path";

/** Path to OpenCode's SQLite database. Configurable via env for testing. */
export const OPENCODE_DB_ENV = "KOLU_OPENCODE_DB";

/** The env key the e2e harness sets to point detection at fixtures. */
export const OPENCODE_ENV_KEYS = [OPENCODE_DB_ENV] as const;

export const OPENCODE_DB_PATH =
  process.env[OPENCODE_DB_ENV] ??
  path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/** Path to the SQLite WAL file — fs.watch this to detect writes. */
export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;
