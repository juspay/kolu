/**
 * Codex integration — pure functions and IO helpers for detecting
 * Codex sessions and deriving state from its SQLite database.
 *
 * No dependency on server internals (no updateServerMetadata, no TerminalProcess).
 * The server's provider imports these and wires them into the metadata system.
 *
 * Architecture: Codex TUI mode owns `~/.codex/state_5.sqlite` directly via
 * SQLite WAL mode. Sessions are tracked in the `threads` table, with the
 * current working directory stored in the `cwd` column.
 *
 * Read concurrency is safe because Codex uses WAL mode — readers don't
 * block writers and vice versa. We open the DB read-only.
 *
 * State derivation from the `threads` table:
 *   - `updated_at` advancing without completion state → "thinking"
 *   - `approval_mode` and internal state imply tool execution → "tool_use"
 *   - Session idle with completion indicators → "waiting"
 */

import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { match } from "ts-pattern";
import { CODEX_STATE_PATH } from "./config.ts";

// Re-export config so consumers can reference it (e.g. for env override docs).
export { CODEX_STATE_PATH, CODEX_STATE_WAL_PATH } from "./config.ts";

// --- Codex schemas (single source of truth) ---

export { TaskProgressSchema, type TaskProgress, type Logger } from "anyagent";
import { TaskProgressSchema, type TaskProgress, type Logger } from "anyagent";

export const CodexInfoSchema = z.object({
  kind: z.literal("codex"),
  /** Current state derived from thread activity. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Session ID from Codex's database (UUID format). */
  sessionId: z.string(),
  /** Model identifier if available (e.g. "gpt-5.4"). */
  model: z.string().nullable(),
  /** Session title from Codex (user prompt or auto-generated). */
  summary: z.string().nullable(),
  /** Always null — Codex doesn't have a todo/task system yet. */
  taskProgress: TaskProgressSchema.nullable(),
  /** Running context-window token count from `tokens_used`. */
  contextTokens: z.number().nullable(),
});

export type CodexInfo = z.infer<typeof CodexInfoSchema>;

// --- Database helpers ---

/** Run `fn` with a DatabaseSync connection. If `db` is provided, uses it
 *  without owning it (caller manages lifecycle). If absent, opens a fresh
 *  connection and closes it after `fn` returns. Returns null if the DB
 *  can't be opened or if `fn` throws (logged at error via `errorMsg`). */
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

// --- Database session lookup ---

export interface CodexSession {
  id: string;
  title: string | null;
  directory: string;
}

/** Open a read-only connection to Codex's database. Returns null if absent.
 *  Caller MUST close the returned database when done. */
export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(CODEX_STATE_PATH, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: CODEX_STATE_PATH }, "codex db unavailable");
    return null;
  }
}

/**
 * Find the most recently updated thread for a given directory.
 * Returns null if no threads exist for that directory or the DB is absent.
 *
 * Heuristic: pick the thread with the largest `updated_at` — the one
 * the user most recently interacted with. If multiple threads share a
 * directory, this picks the active one in practice.
 */
export function findSessionByDirectory(
  directory: string,
  log?: Logger,
): CodexSession | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, title, cwd FROM threads WHERE cwd = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 1",
        )
        .get(directory) as
        | { id: string; title: string; cwd: string }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        title: row.title || null,
        directory: row.cwd,
      };
    },
    "codex session query failed",
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
        .prepare("SELECT title FROM threads WHERE id = ?")
        .get(sessionId) as { title: string } | undefined;
      return row?.title || null;
    },
    "codex session title query failed",
    { sessionId },
    log,
    db,
  );
}

// --- Context-token lookup ---

/**
 * Read the thread's running token total from `tokens_used`.
 * Returns null if unavailable.
 */
export function getSessionContextTokens(
  sessionId: string,
  log?: Logger,
  db?: DatabaseSync,
): number | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT tokens_used FROM threads WHERE id = ?")
        .get(sessionId) as { tokens_used: number } | undefined;
      return row?.tokens_used ?? null;
    },
    "codex tokens query failed",
    { sessionId },
    log,
    db,
  );
}

// --- State derivation ---

/** Shape of relevant thread columns. */
interface ThreadRow {
  id: string;
  title: string;
  model: string;
  tokens_used: number;
  created_at: number;
  updated_at: number;
  approval_mode: string;
  has_user_event: number;
}

/** State derived from thread row. */
export type DerivedState = {
  state: CodexInfo["state"];
  model: string | null;
};

/**
 * Read the thread row and derive Kolu state from it.
 * Returns null if the thread doesn't exist or the DB is absent.
 *
 * Pass an existing `db` to share a connection with the caller — used by
 * `createCodexWatcher` to avoid opening/closing on every WAL event.
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
          "SELECT id, title, model, tokens_used, created_at, updated_at, approval_mode, has_user_event FROM threads WHERE id = ?",
        )
        .get(sessionId) as ThreadRow | undefined;
      if (!row) return null;
      return parseThreadState(row);
    },
    "codex thread query failed",
    { sessionId },
    log,
    db,
  );
}

/** Parse thread row into derived state.
 *  Exported for unit testing. */
export function parseThreadState(row: ThreadRow): DerivedState | null {
  // Codex state inference is heuristic-based:
  // - If updated_at is recent relative to created_at, session is active
  // - approval_mode hints at tool use ("on-request" means tools need approval)
  // - has_user_event indicates user interaction happened

  const now = Date.now();
  const updatedAtMs = row.updated_at * 1000;
  const createdAtMs = row.created_at * 1000;

  // Determine if session is recently active (within last 30 seconds)
  const isRecentlyActive = now - updatedAtMs < 30000;

  // Determine if session has been idle (no updates for 5+ seconds after creation)
  const isIdle = !isRecentlyActive && updatedAtMs - createdAtMs > 5000;

  return match({
    isRecentlyActive,
    isIdle,
    hasUserEvent: row.has_user_event === 1,
    approvalMode: row.approval_mode,
  })
    .with({ isIdle: true, hasUserEvent: true }, () => ({
      state: "waiting" as const,
      model: row.model || null,
    }))
    .with({ approvalMode: "on-request", isRecentlyActive: true }, () => ({
      state: "tool_use" as const,
      model: row.model || null,
    }))
    .with({ isRecentlyActive: true }, () => ({
      state: "thinking" as const,
      model: row.model || null,
    }))
    .otherwise(() => ({
      state: "waiting" as const,
      model: row.model || null,
    }));
}

// --- Session watcher (encapsulates per-session lifecycle) ---

export { createCodexWatcher, type CodexWatcher } from "./session-watcher.ts";

// --- Shared WAL watcher ---

export { subscribeCodexDb } from "./wal-watcher.ts";

// --- AgentProvider instance ---

export { codexProvider } from "./agent-provider.ts";
