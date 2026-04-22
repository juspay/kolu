import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "anyagent";

export const CODEX_HOME =
  process.env.KOLU_CODEX_HOME ?? path.join(os.homedir(), ".codex");

export const CODEX_STATE_DB_PATH = process.env.KOLU_CODEX_STATE_DB ?? null;

export function findCodexStateDbPath(log?: Logger): string | null {
  if (CODEX_STATE_DB_PATH) return CODEX_STATE_DB_PATH;

  let entries: string[];
  try {
    entries = fs.readdirSync(CODEX_HOME);
  } catch (err) {
    log?.debug({ err, dir: CODEX_HOME }, "codex home unavailable");
    return null;
  }

  const candidates = entries
    .map((name) => {
      const match = /^state_(\d+)\.sqlite$/.exec(name);
      const versionPart = match?.[1];
      if (!versionPart) return null;
      return {
        path: path.join(CODEX_HOME, name),
        version: Number.parseInt(versionPart, 10),
      };
    })
    .filter(
      (entry): entry is { path: string; version: number } => entry !== null,
    )
    .sort((a, b) => b.version - a.version);

  return candidates[0]?.path ?? null;
}

export function codexStateWalPath(dbPath: string): string {
  return `${dbPath}-wal`;
}
