import os from "node:os";
import path from "node:path";

/** Root of Xyne's per-user state directory (`~/.xyne`): `auth.json`,
 *  models, settings, and `agent/sessions/`. Overridable via
 *  `KOLU_XYNE_DIR`. */
export const XYNE_DIR =
  process.env.KOLU_XYNE_DIR ?? path.join(os.homedir(), ".xyne");

/** Per-cwd session files live under this directory
 *  (`sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl`). */
export const SESSIONS_DIR = path.join(XYNE_DIR, "agent", "sessions");

/** The env key the e2e harness sets to point detection at fixtures. */
export const XYNE_ENV_KEYS = ["KOLU_XYNE_DIR"] as const;
