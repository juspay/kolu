import os from "node:os";
import path from "node:path";

export const GROK_DIR_ENV = "KOLU_GROK_DIR";

export const GROK_ENV_KEYS = [GROK_DIR_ENV] as const;

export const GROK_DIR =
  process.env[GROK_DIR_ENV] ?? path.join(os.homedir(), ".grok");

/** Live process map: `[{ session_id, pid, cwd, opened_at }, …]`. */
export const ACTIVE_SESSIONS_PATH = path.join(GROK_DIR, "active_sessions.json");

/** Per-cwd session roots live under this directory. */
export const SESSIONS_DIR = path.join(GROK_DIR, "sessions");
