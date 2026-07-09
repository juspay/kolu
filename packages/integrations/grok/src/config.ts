/** Configuration constants for the Grok Build CLI integration.
 *  Leaf module — no imports from other package files. */

import os from "node:os";
import path from "node:path";

/** Root of Grok Build's per-user state directory. Contains
 *  `active_sessions.json`, `sessions/<urlencode(cwd)>/<uuid>/`, auth,
 *  config, and skills. Overridable via `KOLU_GROK_DIR` so e2e fixtures
 *  and unit tests never scan the developer's real `~/.grok`. */
export const GROK_DIR =
  process.env.KOLU_GROK_DIR ?? path.join(os.homedir(), ".grok");

/** Live process map: `[{ session_id, pid, cwd, opened_at }, …]`. */
export const ACTIVE_SESSIONS_PATH = path.join(GROK_DIR, "active_sessions.json");

/** Per-cwd session roots live under this directory. */
export const SESSIONS_DIR = path.join(GROK_DIR, "sessions");
