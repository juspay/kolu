import os from "node:os";
import path from "node:path";

export const OPENCODE_DB_ENV = "KOLU_OPENCODE_DB";

export const OPENCODE_ENV_KEYS = [OPENCODE_DB_ENV] as const;

export const OPENCODE_DB_PATH =
  process.env[OPENCODE_DB_ENV] ??
  path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;
