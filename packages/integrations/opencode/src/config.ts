/** Configuration constants for the OpenCode integration.
 *  Leaf module — no imports from other package files. */

import os from "node:os";
import path from "node:path";

/** OpenCode's DB path relative to the user's HOME. Both the local
 *  (`OPENCODE_DB_PATH`) and remote (server's `remote-opencode.ts`)
 *  paths derive from this so there's a single source of truth for
 *  "where does OpenCode keep its SQLite DB". */
export const OPENCODE_DB_REL = ".local/share/opencode/opencode.db";

/** Path to OpenCode's SQLite database. Configurable via env for testing. */
export const OPENCODE_DB_PATH =
  process.env.KOLU_OPENCODE_DB ?? path.join(os.homedir(), OPENCODE_DB_REL);

/** Path to the SQLite WAL file — fs.watch this to detect writes. */
export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;
