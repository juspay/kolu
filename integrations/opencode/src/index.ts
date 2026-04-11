/**
 * OpenCode integration — pure functions and IO helpers for detecting
 * OpenCode sessions and deriving state from its SQLite database.
 *
 * No dependency on server internals (no updateMetadata, no TerminalProcess).
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

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { match } from "ts-pattern";

// --- OpenCode schemas (single source of truth) ---

/** Task progress for a session — total todos and completed count.
 *  Defined locally (not imported from kolu-claude-code) to avoid an
 *  integration↔integration dependency. Structurally identical to
 *  ClaudeCodeInfoSchema's TaskProgress so the discriminated union in
 *  kolu-common composes cleanly. */
export const TaskProgressSchema = z.object({
  total: z.number(),
  completed: z.number(),
});

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

export const OpenCodeInfoSchema = z.object({
  kind: z.literal("opencode"),
  /** Current state derived from the latest session message. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Session ID from OpenCode's database (e.g. "ses_..."). */
  sessionId: z.string(),
  /** Model identifier if available (e.g. "litellm/glm-latest"). */
  model: z.string().nullable(),
  /** Session title from OpenCode. */
  summary: z.string().nullable(),
  /** Todo progress from OpenCode's `todo` table. null when no todos. */
  taskProgress: TaskProgressSchema.nullable(),
});

export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;

// --- Configuration ---

/** Path to OpenCode's SQLite database. Configurable via env for testing. */
export const OPENCODE_DB_PATH =
  process.env.KOLU_OPENCODE_DB ??
  path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/** Path to the SQLite WAL file — fs.watch this to detect writes. */
export const OPENCODE_DB_WAL_PATH = `${OPENCODE_DB_PATH}-wal`;

// --- Logger type ---

type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

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
  const db = openDb(log);
  if (!db) return null;
  try {
    const row = db
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
  } catch (err) {
    log?.warn({ err, directory }, "opencode session query failed");
    return null;
  } finally {
    db.close();
  }
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
  const ownsDb = db === undefined;
  const conn = db ?? openDb(log);
  if (!conn) return null;
  try {
    const row = conn
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed FROM todo WHERE session_id = ?",
      )
      .get(sessionId) as
      | { total: number; completed: number | null }
      | undefined;
    if (!row || row.total === 0) return null;
    return { total: row.total, completed: row.completed ?? 0 };
  } catch (err) {
    log?.warn({ err, sessionId }, "opencode todo query failed");
    return null;
  } finally {
    if (ownsDb) conn.close();
  }
}

// --- State derivation ---

/** Shape of the JSON in `message.data`. Only the fields we read. */
interface MessageData {
  role?: "user" | "assistant";
  modelID?: string;
  providerID?: string;
  finish?: string;
  time?: { created?: number; completed?: number };
}

export type DerivedState = {
  state: OpenCodeInfo["state"];
  model: string | null;
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
  const ownsDb = db === undefined;
  const conn = db ?? openDb(log);
  if (!conn) return null;
  try {
    const row = conn
      .prepare(
        "SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1",
      )
      .get(sessionId) as { data: string } | undefined;
    if (!row) return null;
    return parseMessageState(row.data);
  } catch (err) {
    log?.warn({ err, sessionId }, "opencode message query failed");
    return null;
  } finally {
    if (ownsDb) conn.close();
  }
}

/** Parse a `message.data` JSON blob into derived state.
 *  Exported for unit testing. */
export function parseMessageState(data: string): DerivedState | null {
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
      // Otherwise still working (no completion yet, or non-stop finish reason)
      return { state: "thinking" as const, model };
    })
    .otherwise(() => null);
}

// --- File watching ---

// --- Session watcher (encapsulates per-session lifecycle) ---

export {
  createOpenCodeWatcher,
  infoEqual,
  type OpenCodeWatcher,
} from "./session-watcher.ts";

/** Watch the OpenCode WAL file for changes. Returns a cleanup function.
 *  Falls back to watching the parent directory if the WAL doesn't exist
 *  yet — OpenCode creates it lazily when the DB is first written to.
 *  Returns a no-op cleanup if no watcher could be attached. */
export function watchOpenCodeDb(
  onChange: () => void,
  log?: Logger,
): () => void {
  // Try the WAL file first
  try {
    const w = fs.watch(OPENCODE_DB_WAL_PATH, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug({ err, path: OPENCODE_DB_WAL_PATH }, "WAL fs.watch failed");
    }
  }

  // Fall back to the parent directory — fires when WAL is created
  const dir = path.dirname(OPENCODE_DB_PATH);
  try {
    const w = fs.watch(dir, () => onChange());
    return () => w.close();
  } catch (err) {
    log?.debug({ err, dir }, "opencode db dir fs.watch failed");
    return () => {};
  }
}
