/**
 * OpenCode core — pure functions and IO helpers for detecting OpenCode
 * sessions and deriving state from its SQLite database.
 *
 * No dependency on server internals (no updateServerMetadata, no TerminalProcess).
 * The server's provider imports these and wires them into the metadata system.
 *
 * Architecture: OpenCode (TUI mode) is a single process that owns
 * `~/.local/share/opencode/opencode.db` directly via SQLite WAL mode.
 * The TUI does NOT expose an HTTP server by default — that's `opencode serve`.
 * So the only way to observe TUI sessions is to read the SQLite DB directly.
 *
 * Read concurrency is safe because OpenCode uses WAL mode — readers don't
 * block writers and vice versa. We open the DB read-only.
 *
 * State derivation from the latest message in a session:
 *   - role: "user"                          → "thinking" (waiting for assistant)
 *   - role: "assistant", no time.completed  → "thinking" (in flight)
 *   - role: "assistant", finish: "stop"     → "waiting"  (assistant finished)
 *   - role: "assistant", finish: other      → "thinking" (still working)
 *
 * Structure note: this file holds the leaf module. Peers `session-watcher.ts`,
 * `wal-watcher.ts`, and `agent-provider.ts` import from here; `index.ts` is
 * a pure barrel re-exporting from all of them plus `schemas.ts` / `config.ts`.
 */

import { DatabaseSync } from "node:sqlite";
import { classifyByAwaiting } from "@kolu/anyagent";
import type { Logger } from "kolu-shared";
import { withDb as sharedWithDb } from "kolu-shared/sqlite";
import { match } from "ts-pattern";
import { OPENCODE_DB_PATH } from "./config.ts";
import type { OpenCodeInfo, TaskProgress } from "./schemas.ts";

// --- Database helpers ---

/** OpenCode-specific `withDb` — partial application of anyagent's
 *  shared helper over our `openDb`. Keeps the local call signature so
 *  consumers within this package don't need to change. */
function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: DatabaseSync,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log, db);
}

// --- Database session lookup ---

export interface OpenCodeSession {
  id: string;
  title: string | null;
  directory: string;
}

/** Open a read-only connection to OpenCode's database. Returns null if absent.
 *  Caller MUST close the returned database when done. */
export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(OPENCODE_DB_PATH, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: OPENCODE_DB_PATH }, "opencode db unavailable");
    return null;
  }
}

/**
 * Find the most recently updated session for a given directory.
 * Returns null if no sessions exist for that directory or the DB is absent.
 *
 * Heuristic: pick the session with the largest `time_updated` — the one
 * the user most recently interacted with. If multiple sessions share a
 * directory, this picks the active one in practice.
 */
export function findSessionByDirectory(
  directory: string,
  log?: Logger,
): OpenCodeSession | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, title, directory FROM session WHERE directory = ? AND time_archived IS NULL ORDER BY time_updated DESC LIMIT 1",
        )
        .get(directory) as
        | { id: string; title: string; directory: string }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        title: row.title || null,
        directory: row.directory,
      };
    },
    "opencode session query failed",
    { directory },
    log,
  );
}

// --- Session title refresh ---

/** Re-read the current session title from the DB. Returns null if absent. */
export function getSessionTitle(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): string | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT title FROM session WHERE id = ?")
        .get(sessionId) as { title: string } | undefined;
      return row?.title || null;
    },
    "opencode session title query failed",
    { sessionId },
    log,
    db,
  );
}

// --- Todo progress ---

/**
 * Read todo progress for a session from the `todo` table.
 * Returns null if the session has no todos.
 *
 * Pass an existing `db` to share a connection with the caller — used by
 * `createOpenCodeWatcher` to avoid opening/closing on every WAL event.
 * If `db` is omitted, opens and closes its own connection.
 */
export function getSessionTaskProgress(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): TaskProgress | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM todo WHERE session_id = ?",
        )
        .get(sessionId) as
        | { total: number; completed: number | null }
        | undefined;
      if (!row || row.total === 0) return null;
      return { total: row.total, completed: row.completed ?? 0 };
    },
    "opencode todo query failed",
    { sessionId },
    log,
    db,
  );
}

// --- Context-token lookup ---

/**
 * Read the latest assistant message's running context-token total from
 * `tokens.total`. Independent of `deriveSessionState` because the signals
 * terminate differently: state pivots on the newest message of any role,
 * but the token total only lives on assistant messages — using the single
 * latest message would blank the count whenever the user's prompt is the
 * newest row (Thinking state).
 *
 * One indexed query against (session_id, time_created). `json_extract`
 * forces per-row blob inspection, but the walker stops at the first match
 * — in practice 1–3 rows.
 */
export function getLatestAssistantContextTokens(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): number | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant' ORDER BY time_created DESC LIMIT 1",
        )
        .get(sessionId) as { data: string } | undefined;
      if (!row) return null;
      let parsed: MessageData;
      try {
        parsed = JSON.parse(row.data) as MessageData;
      } catch (err) {
        // OpenCode writes this JSON itself, so a parse failure is a real
        // anomaly — surface it rather than silently blanking the badge.
        log?.error(
          { err, sessionId },
          "opencode assistant message.data parse failed",
        );
        return null;
      }
      return parsed.tokens?.total ?? null;
    },
    "opencode context-tokens query failed",
    { sessionId },
    log,
    db,
  );
}

// --- Tool detection ---

/** OpenCode built-in tools whose pending invocation means the agent is
 *  awaiting the human. Both call `Question.Service.ask` and write a
 *  `part` row with `state.status = "running"` while blocking on the
 *  user's reply (upstream verification:
 *  `packages/opencode/src/tool/question.ts:24` and
 *  `packages/opencode/src/tool/plan.ts:29`). Other interactive flows
 *  (`ctx.ask` permission prompts inside `shell`/`edit`/`write`/etc.)
 *  don't surface a distinct `tool` value — the part stays `shell`/etc.
 *  and is indistinguishable from a real-work tool. */
const AWAITING_USER_TOOLS = ["question", "plan_exit"] as const;

/** Classify the tool parts currently in the "running" state for one
 *  message (the current assistant turn) — scoped per-message rather
 *  than per-session so a transcript with thousands of completed tool
 *  parts stays cheap to scan.
 *
 *  Returns `null` when no tools are running (the caller keeps its base
 *  state), `"tool_use"` when at least one real-work tool is in flight,
 *  and `"awaiting_user"` when every running part is in
 *  `AWAITING_USER_TOOLS`. One SQL pass counts total + awaiting using
 *  the `part_message_id_id_idx` index. */
export function runningToolsBucket(
  messageId: string,
  log?: Logger,
  db?: DatabaseSync,
): "tool_use" | "awaiting_user" | null {
  // SQLite's parameter binding doesn't accept arrays for `IN (...)`,
  // so the placeholder list is constructed inline from a constant —
  // safe because every value is a hard-coded literal, not user input.
  const placeholders = AWAITING_USER_TOOLS.map(() => "?").join(", ");
  return (
    withDb(
      (conn) => {
        const row = conn
          .prepare(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN json_extract(data, '$.tool') IN (${placeholders}) THEN 1 ELSE 0 END) AS awaiting FROM part WHERE message_id = ? AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'running'`,
          )
          .get(...AWAITING_USER_TOOLS, messageId) as
          | { total: number; awaiting: number | null }
          | undefined;
        const total = row?.total ?? 0;
        if (total === 0) return null;
        return classifyByAwaiting(row?.awaiting ?? 0, total);
      },
      "opencode running-tools query failed",
      { messageId },
      log,
      db,
    ) ?? null
  );
}

// --- State derivation ---

/** Shape of the JSON in `message.data`. Only the fields we read. */
interface MessageData {
  role?: "user" | "assistant";
  modelID?: string;
  providerID?: string;
  finish?: string;
  time?: { created?: number; completed?: number };
  /** Present on assistant messages once OpenCode has accounted the turn.
   *  `total` is the running session token count, pre-summed by the
   *  provider — we just pass it through. */
  tokens?: { total?: number };
}

/** State derived from message JSON content only. Token telemetry is a
 *  separate signal (see `getLatestAssistantContextTokens`) because the
 *  latest-message lens this function provides doesn't match the
 *  latest-assistant-message lens that context accounting needs. */
export type ParsedMessageState = {
  state: OpenCodeInfo["state"];
  model: string | null;
};

/** Full derived state including the message ID for scoping
 *  downstream queries (e.g. tool-part lookup) to the current turn. */
export type DerivedState = ParsedMessageState & {
  messageId: string;
};

/**
 * Read the latest message for a session and derive Kolu state from it.
 * Returns null if the session has no messages or the DB is absent.
 *
 * Pass an existing `db` to share a connection with the caller — used by
 * `createOpenCodeWatcher` to avoid opening/closing on every WAL event.
 * If `db` is omitted, opens and closes its own connection.
 */
export function deriveSessionState(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): DerivedState | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1",
        )
        .get(sessionId) as { id: string; data: string } | undefined;
      if (!row) return null;
      const parsed = parseMessageState(row.data);
      if (!parsed) return null;
      return { ...parsed, messageId: row.id };
    },
    "opencode message query failed",
    { sessionId },
    log,
    db,
  );
}

/** Parse a `message.data` JSON blob into derived state.
 *  Exported for unit testing. */
export function parseMessageState(data: string): ParsedMessageState | null {
  let parsed: MessageData;
  try {
    parsed = JSON.parse(data) as MessageData;
  } catch {
    return null;
  }

  return match(parsed)
    .with({ role: "user" }, () => ({
      state: "thinking" as const,
      model: null,
    }))
    .with({ role: "assistant" }, (m) => {
      const model = m.modelID
        ? m.providerID
          ? `${m.providerID}/${m.modelID}`
          : m.modelID
        : null;
      // Assistant message with completion timestamp + clean stop = waiting
      if (m.time?.completed && m.finish === "stop") {
        return { state: "waiting" as const, model };
      }
      // Otherwise still working (no completion yet, or non-stop finish
      // reason like "tool-calls"). The watcher upgrades "thinking" to
      // "tool_use" when hasRunningTools() finds active tool parts.
      return { state: "thinking" as const, model };
    })
    .otherwise(() => null);
}
