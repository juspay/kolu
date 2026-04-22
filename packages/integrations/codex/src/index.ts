import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TaskProgressSchema, type Logger } from "anyagent";
import { findCodexStateDbPath } from "./config.ts";
export { CodexInfoSchema, type CodexInfo } from "./schema.ts";

export { TaskProgressSchema, type Logger } from "anyagent";
export {
  findCodexStateDbPath,
  CODEX_HOME,
  CODEX_STATE_DB_PATH,
} from "./config.ts";
import type { CodexInfo } from "./schema.ts";

export interface CodexThreadSnapshot {
  id: string;
  title: string | null;
  rolloutPath: string;
  model: string | null;
}

export interface CodexSession {
  id: string;
  stateDbPath: string;
}

interface RolloutRecord {
  type?: string;
  payload?: {
    type?: string;
    call_id?: string;
  };
}

const ROLLOUT_TAIL_BYTES = 1024 * 1024;

function openDb(dbPath: string, log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: dbPath }, "codex state db unavailable");
    return null;
  }
}

function withDb<T>(
  dbPath: string,
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: DatabaseSync,
): T | null {
  const ownsDb = db === undefined;
  const conn = db ?? openDb(dbPath, log);
  if (!conn) return null;
  try {
    return fn(conn);
  } catch (err) {
    log?.error({ err, ...errorCtx }, errorMsg);
    return null;
  } finally {
    if (ownsDb) conn.close();
  }
}

export function findSessionByDirectory(
  directory: string,
  log?: Logger,
): CodexSession | null {
  const dbPath = findCodexStateDbPath(log);
  if (!dbPath) return null;

  return withDb(
    dbPath,
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, cwd, title, rollout_path, model FROM threads WHERE cwd = ? AND source = 'cli' AND archived = 0 ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC LIMIT 1",
        )
        .get(directory) as
        | {
            id: string;
            cwd: string;
            title: string;
            rollout_path: string;
            model: string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        stateDbPath: dbPath,
      };
    },
    "codex session query failed",
    { directory },
    log,
  );
}

export function getThreadSnapshot(
  sessionId: string,
  dbPath: string,
  log?: Logger,
  db?: DatabaseSync,
): CodexThreadSnapshot | null {
  return withDb(
    dbPath,
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, cwd, title, rollout_path, model FROM threads WHERE id = ?",
        )
        .get(sessionId) as
        | {
            id: string;
            cwd: string;
            title: string;
            rollout_path: string;
            model: string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        title: row.title || null,
        rolloutPath: row.rollout_path,
        model: row.model,
      };
    },
    "codex thread snapshot query failed",
    { sessionId },
    log,
    db,
  );
}

export function tailJsonlLines(filePath: string, bytes: number): string[] {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(Math.min(bytes, stat.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    if (start > 0 && lines.length > 0) lines.shift();
    return lines;
  } catch {
    return [];
  }
}

export function readRolloutState(filePath: string): CodexInfo["state"] | null {
  return deriveRolloutState(tailJsonlLines(filePath, ROLLOUT_TAIL_BYTES));
}

export function deriveRolloutState(lines: string[]): CodexInfo["state"] | null {
  let lastBoundaryIndex = -1;
  let boundaryState: "thinking" | "waiting" | null = null;

  for (const [index, line] of lines.entries()) {
    const parsed = parseRolloutLine(line);
    if (!parsed || parsed.type !== "event_msg") continue;
    if (parsed.payload?.type === "task_started") {
      lastBoundaryIndex = index;
      boundaryState = "thinking";
    }
    if (parsed.payload?.type === "task_complete") {
      lastBoundaryIndex = index;
      boundaryState = "waiting";
    }
  }

  if (boundaryState === "waiting") return "waiting";
  if (boundaryState === null) return null;

  const pendingCalls = new Set<string>();
  for (const line of lines.slice(lastBoundaryIndex + 1)) {
    const parsed = parseRolloutLine(line);
    if (parsed?.type !== "response_item") continue;
    if (
      parsed.payload?.type === "function_call" &&
      typeof parsed.payload.call_id === "string"
    ) {
      pendingCalls.add(parsed.payload.call_id);
    }
    if (
      parsed.payload?.type === "function_call_output" &&
      typeof parsed.payload.call_id === "string"
    ) {
      pendingCalls.delete(parsed.payload.call_id);
    }
  }

  return pendingCalls.size > 0 ? "tool_use" : "thinking";
}

function parseRolloutLine(line: string): RolloutRecord | null {
  try {
    return JSON.parse(line) as RolloutRecord;
  } catch {
    return null;
  }
}

export { createCodexWatcher, type CodexWatcher } from "./session-watcher.ts";
export { subscribeCodexDb } from "./wal-watcher.ts";
export { codexProvider } from "./agent-provider.ts";
