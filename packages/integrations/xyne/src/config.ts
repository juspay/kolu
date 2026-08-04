/** Configuration constants for the Xyne CLI integration.
 *  Leaf module — no imports from other package files. */

import os from "node:os";
import path from "node:path";

/** Root of Xyne's per-user state directory. Contains `auth.json`, models,
 *  settings, and `agent/sessions/`. Overridable via `KOLU_XYNE_DIR` so e2e
 *  fixtures and unit tests never scan the developer's real `~/.xyne`. */
export const XYNE_DIR =
  process.env.KOLU_XYNE_DIR ?? path.join(os.homedir(), ".xyne");

/** Per-cwd session files live under this directory
 *  (`sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl`). */
export const SESSIONS_DIR = path.join(XYNE_DIR, "agent", "sessions");
