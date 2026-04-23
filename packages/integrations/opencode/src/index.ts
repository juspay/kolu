/**
 * OpenCode integration — pure functions and IO helpers for detecting
 * OpenCode sessions and deriving state from its SQLite database.
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
 */

import { DatabaseSync } from "node:sqlite";
import { match } from "ts-pattern";
import { withDb as sharedWithDb, type Logger } from "anyagent";
import { OPENCODE_DB_PATH } from "./config.ts";
import type { OpenCodeInfo, TaskProgress } from "./schemas.ts";

// Re-export config so consumers can reference it (e.g. for env override docs).
export { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

// --- OpenCode schemas (browser-safe; re-exported from ./schemas) ---

export {
  TaskProgressSchema,
  OpenCodeInfoSchema,
  type TaskProgress,
  type OpenCodeInfo,
} from "./schemas.ts";
export { type Logger } from "anyagent";

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

/**
 * Check whether the given message has any tool parts currently in the
 * "running" state. Scoped to one message (the current assistant turn)
 * rather than the entire session — a session with thousands of completed
 * tool parts from prior turns only needs to check the handful of parts
 * belonging to the latest message.
 *
 * Uses the `part_message_id_id_idx` index for an O(parts-in-message)
 * scan, not O(all-parts-in-session).
 */
export function hasRunningTools(
  messageId: string,
  log?: Logger,
  db?: DatabaseSync,
): boolean {
  return (
    withDb(
      (conn) => {
        const row = conn
          .prepare(
            "SELECT COUNT(*) AS n FROM part WHERE message_id = ? AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'running'",
          )
          .get(messageId) as { n: number } | undefined;
        return (row?.n ?? 0) > 0;
      },
      "opencode running-tools query failed",
      { messageId },
      log,
      db,
    ) ?? false
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

// --- Session watcher (encapsulates per-session lifecycle) ---

export {
  createOpenCodeWatcher,
  type OpenCodeWatcher,
} from "./session-watcher.ts";

// --- Shared WAL watcher ---

export { subscribeOpenCodeDb } from "./wal-watcher.ts";

// --- AgentProvider instance ---

export { opencodeProvider } from "./agent-provider.ts";
