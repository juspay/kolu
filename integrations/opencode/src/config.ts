/** Configuration constants for the OpenCode integration.
 *  Leaf module — no imports from other package files. */

import path from "node:path";
import os from "node:os";

/** Path to OpenCode's SQLite database. Configurable via env for testing. */
export const OPENCODE_DB_PATH =
  process.env.KOLU_OPENCODE_DB ??
  path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/** Path to the SQLite WAL file — fs.watch this to detect writes. */
export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;
