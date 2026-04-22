import path from "node:path";
import os from "node:os";

export const CODEX_HOME =
  process.env.KOLU_CODEX_HOME ?? path.join(os.homedir(), ".codex");

export const CODEX_STATE_DB_PATH = path.join(CODEX_HOME, "state_5.sqlite");

export const CODEX_STATE_DB_WAL_PATH = `${CODEX_STATE_DB_PATH}-wal`;

export const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
