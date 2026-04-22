/** Configuration constants for the Codex integration.
 *  Leaf module — no imports from other package files. */

import path from "node:path";
import os from "node:os";

/** Path to Codex's SQLite database. Configurable via env for testing. */
export const CODEX_STATE_PATH =
  process.env.KOLU_CODEX_STATE ??
  path.join(os.homedir(), ".codex", "state_5.sqlite");

/** Path to the SQLite WAL file — fs.watch this to detect writes. */
export const CODEX_STATE_WAL_PATH = `${CODEX_STATE_PATH}-wal`;
