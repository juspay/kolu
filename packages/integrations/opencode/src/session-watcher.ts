/**
 * OpenCodeWatcher — per-session lifecycle over the supplied executor.
 */

import { agentInfoEqual, classifyByAwaiting } from "anyagent";
import type { Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { createDebounceWatcher } from "kolu-shared/sqlite";
import {
  AWAITING_USER_TOOLS,
  type OpenCodeSession,
  parseMessageState,
} from "./core.ts";
import type { OpenCodeInfo, TaskProgress } from "./schemas.ts";
import { subscribeOpenCodeDb } from "./wal-watcher.ts";

const WAL_DEBOUNCE_MS = 150;

export interface OpenCodeWatcher {
  readonly session: OpenCodeSession;
  destroy(): void;
}

export function createOpenCodeWatcher(
  session: OpenCodeSession,
  executor: Executor,
  onChange: (info: OpenCodeInfo) => void,
  log?: Logger,
): OpenCodeWatcher {
  const watcherContext = { session, executor };

  async function readInfo(
    ctx: typeof watcherContext,
  ): Promise<OpenCodeInfo | null> {
    const latest = await latestMessage(ctx.session, ctx.executor, log);
    if (!latest) {
      log?.debug(
        { session: ctx.session.id },
        "no messages yet for opencode session",
      );
      return null;
    }

    const derived = parseMessageState(latest.data);
    if (!derived) return null;
    const state =
      derived.state === "thinking"
        ? ((await runningToolsBucket(
            latest.id,
            ctx.session,
            ctx.executor,
            log,
          )) ?? derived.state)
        : derived.state;
    const taskProgress = await getSessionTaskProgress(
      ctx.session,
      ctx.executor,
      log,
    );
    const summary =
      (await getSessionTitle(ctx.session, ctx.executor, log)) ??
      ctx.session.title;
    const contextTokens = await getLatestAssistantContextTokens(
      ctx.session,
      ctx.executor,
      log,
    );

    return {
      kind: "opencode",
      state,
      sessionId: ctx.session.id,
      model: derived.model,
      summary,
      taskProgress,
      contextTokens,
    };
  }

  return createDebounceWatcher({
    session,
    label: "opencode: session",
    debounceMs: WAL_DEBOUNCE_MS,
    db: watcherContext,
    subscribe: (onEvent, onError, plog) =>
      subscribeOpenCodeDb(
        executor,
        session.dbPath,
        session.walPath,
        onEvent,
        onError,
        plog,
      ),
    refresh: readInfo,
    isEqual: agentInfoEqual,
    onChange: (info) => {
      log?.debug(
        { state: info.state, model: info.model, session: info.sessionId },
        "opencode state updated",
      );
      onChange(info);
    },
    logCtx: { session: session.id },
    log,
  });
}

async function queryRows(
  session: OpenCodeSession,
  executor: Executor,
  sql: string,
  params: ReadonlyArray<string | number | null>,
  label: string,
  log?: Logger,
): Promise<Array<Record<string, unknown>> | null> {
  try {
    return await executor.queryDb(session.dbPath, sql, params);
  } catch (err) {
    log?.debug({ err, session: session.id }, label);
    return null;
  }
}

async function latestMessage(
  session: OpenCodeSession,
  executor: Executor,
  log?: Logger,
): Promise<{ id: string; data: string } | null> {
  const rows = await queryRows(
    session,
    executor,
    "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1",
    [session.id],
    "opencode message query failed",
    log,
  );
  const row = rows?.[0];
  return row && typeof row.id === "string" && typeof row.data === "string"
    ? { id: row.id, data: row.data }
    : null;
}

async function runningToolsBucket(
  messageId: string,
  session: OpenCodeSession,
  executor: Executor,
  log?: Logger,
): Promise<"tool_use" | "awaiting_user" | null> {
  const placeholders = AWAITING_USER_TOOLS.map(() => "?").join(", ");
  const rows = await queryRows(
    session,
    executor,
    `SELECT COUNT(*) AS total, SUM(CASE WHEN json_extract(data, '$.tool') IN (${placeholders}) THEN 1 ELSE 0 END) AS awaiting FROM part WHERE message_id = ? AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'running'`,
    [...AWAITING_USER_TOOLS, messageId],
    "opencode running-tools query failed",
    log,
  );
  const row = rows?.[0];
  const total = typeof row?.total === "number" ? row.total : 0;
  if (total === 0) return null;
  const awaiting = typeof row?.awaiting === "number" ? row.awaiting : 0;
  return classifyByAwaiting(awaiting, total);
}

async function getSessionTaskProgress(
  session: OpenCodeSession,
  executor: Executor,
  log?: Logger,
): Promise<TaskProgress | null> {
  const rows = await queryRows(
    session,
    executor,
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM todo WHERE session_id = ?",
    [session.id],
    "opencode todo query failed",
    log,
  );
  const row = rows?.[0];
  const total = typeof row?.total === "number" ? row.total : 0;
  if (total === 0) return null;
  return {
    total,
    completed: typeof row?.completed === "number" ? row.completed : 0,
  };
}

async function getSessionTitle(
  session: OpenCodeSession,
  executor: Executor,
  log?: Logger,
): Promise<string | null> {
  const rows = await queryRows(
    session,
    executor,
    "SELECT title FROM session WHERE id = ?",
    [session.id],
    "opencode session title query failed",
    log,
  );
  const title = rows?.[0]?.title;
  return typeof title === "string" && title ? title : null;
}

async function getLatestAssistantContextTokens(
  session: OpenCodeSession,
  executor: Executor,
  log?: Logger,
): Promise<number | null> {
  const rows = await queryRows(
    session,
    executor,
    "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant' ORDER BY time_created DESC LIMIT 1",
    [session.id],
    "opencode context-tokens query failed",
    log,
  );
  const data = rows?.[0]?.data;
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as { tokens?: { total?: number } };
    return parsed.tokens?.total ?? null;
  } catch (err) {
    log?.error(
      { err, sessionId: session.id },
      "opencode assistant message.data parse failed",
    );
    return null;
  }
}
