import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CODEX_STATE_DB_PATH } from "./config.ts";

export {
  CODEX_HOME,
  CODEX_STATE_DB_PATH,
  CODEX_STATE_DB_WAL_PATH,
  CODEX_SESSIONS_DIR,
} from "./config.ts";

export { TaskProgressSchema, type TaskProgress, type Logger } from "anyagent";
import { TaskProgressSchema, type TaskProgress, type Logger } from "anyagent";

export const CodexInfoSchema = z.object({
  kind: z.literal("codex"),
  state: z.enum(["thinking", "tool_use", "waiting"]),
  sessionId: z.string(),
  model: z.string().nullable(),
  summary: z.string().nullable(),
  taskProgress: TaskProgressSchema.nullable(),
  contextTokens: z.number().nullable(),
});

export type CodexInfo = z.infer<typeof CodexInfoSchema>;

function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: DatabaseSync,
): T | null {
  const ownsDb = db === undefined;
  const conn = db ?? openDb(log);
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

export interface CodexSession {
  id: string;
  rolloutPath: string;
  cwd: string;
  title: string | null;
  model: string | null;
  tokensUsed: number;
}

export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(CODEX_STATE_DB_PATH, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: CODEX_STATE_DB_PATH }, "codex db unavailable");
    return null;
  }
}

export function findSessionByDirectory(
  directory: string,
  log?: Logger,
): CodexSession | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, rollout_path, cwd, title, model, tokens_used FROM threads WHERE cwd = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1",
        )
        .get(directory) as
        | {
            id: string;
            rollout_path: string;
            cwd: string;
            title: string | null;
            model: string | null;
            tokens_used: number;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        rolloutPath: row.rollout_path,
        cwd: row.cwd,
        title: row.title,
        model: row.model,
        tokensUsed: row.tokens_used,
      };
    },
    "codex session query failed",
    { directory },
    log,
  );
}

export function getSessionTitle(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): string | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT title FROM threads WHERE id = ?")
        .get(sessionId) as { title: string | null } | undefined;
      return row?.title ?? null;
    },
    "codex session title query failed",
    { sessionId },
    log,
    db,
  );
}

export function getThreadTokens(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): number | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT tokens_used FROM threads WHERE id = ?")
        .get(sessionId) as { tokens_used: number } | undefined;
      if (!row) return null;
      return row.tokens_used > 0 ? row.tokens_used : null;
    },
    "codex tokens query failed",
    { sessionId },
    log,
    db,
  );
}

export function getThreadModel(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): string | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT model FROM threads WHERE id = ?")
        .get(sessionId) as { model: string | null } | undefined;
      return row?.model ?? null;
    },
    "codex model query failed",
    { sessionId },
    log,
    db,
  );
}

export type DerivedState = {
  state: CodexInfo["state"];
  contextTokens: number | null;
};

const TAIL_BYTES = 256 * 1024;

function tailJsonlLines(filePath: string, bytes: number): string[] {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(Math.min(bytes, stat.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    if (start > 0 && lines.length > 0) lines.shift();
    return lines;
  } catch {
    return [];
  }
}

export function deriveSessionState(
  rolloutPath: string,
  log?: Logger,
): DerivedState | null {
  let lastTaskStarted: { turnId: string } | null = null;
  let lastTaskComplete: { turnId: string } | null = null;
  let lastContextTokens: number | null = null;
  const openCalls = new Set<string>();

  const lines = tailJsonlLines(rolloutPath, TAIL_BYTES);
  if (lines.length === 0) return null;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = entry.type as string | undefined;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!type || !payload) continue;

    if (type === "event_msg") {
      const eventType = payload.type as string | undefined;
      if (eventType === "task_started") {
        lastTaskStarted = { turnId: payload.turn_id as string };
        lastTaskComplete = null;
        openCalls.clear();
      } else if (eventType === "task_complete") {
        lastTaskComplete = { turnId: payload.turn_id as string };
        openCalls.clear();
      } else if (eventType === "token_count") {
        const info = payload.info as Record<string, unknown> | null;
        if (info) {
          const totalUsage = info.total_token_usage as
            | Record<string, unknown>
            | undefined;
          if (totalUsage && typeof totalUsage.total_tokens === "number") {
            lastContextTokens = totalUsage.total_tokens;
          }
        }
      }
    }

    if (type === "response_item") {
      const itemType = payload.type as string | undefined;
      if (itemType === "function_call") {
        const callId = payload.call_id as string | undefined;
        if (callId) openCalls.add(callId);
      } else if (itemType === "function_call_output") {
        const callId = payload.call_id as string | undefined;
        if (callId) openCalls.delete(callId);
      }
    }
  }

  if (!lastTaskStarted) return null;

  if (lastTaskComplete && lastTaskComplete.turnId === lastTaskStarted.turnId) {
    return { state: "waiting", contextTokens: lastContextTokens };
  }

  if (openCalls.size > 0) {
    return { state: "tool_use", contextTokens: lastContextTokens };
  }

  return { state: "thinking", contextTokens: lastContextTokens };
}

export { createCodexWatcher, type CodexWatcher } from "./session-watcher.ts";

export { subscribeCodexDb } from "./wal-watcher.ts";

export { codexProvider } from "./agent-provider.ts";
