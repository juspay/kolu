import { DatabaseSync } from "node:sqlite";
import { classifyByAwaiting } from "anyagent";
import type { Logger } from "kolu-shared";
import { readDbList, withDb as sharedWithDb } from "kolu-shared/sqlite";
import { CODEX_DB_PATH } from "./config.ts";
import type { CodexInfo } from "./schemas.ts";

function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: DatabaseSync,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log, db);
}

const MAX_CANDIDATES = 64;

export interface CodexSession {
  /** Thread id (uuid v7). */
  id: string;
  /** Absolute path to the rollout JSONL — copied from the DB row at
   *  match time so the watcher doesn't re-query to locate its file. */
  rolloutPath: string;
  /** Epoch-ms the thread was created, decoded from the uuidv7 `id`'s leading
   *  48-bit timestamp. Null if `id` isn't a decodable uuidv7. Computed once at
   *  match time — the id is immutable, so the watcher copies it straight onto
   *  every `CodexInfo` it emits. */
  startedAt: number | null;
}

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidV7TimestampMs(id: string): number | null {
  if (!UUID_V7_RE.test(id)) return null;
  const ms = Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
  return Number.isFinite(ms) ? ms : null;
}

export const REQUIRED_THREAD_COLUMNS: readonly string[] = [
  "id",
  "rollout_path",
  "cwd",
  "source",
  "archived",
  "updated_at_ms",
  "title",
  "model",
];

/** Return the list of required columns missing from the `threads` table
 *  on the given DB — empty array when the schema matches. Pure-ish
 *  (reads from the DB but has no side effects); exported for unit
 *  tests. */
export function missingThreadColumns(db: DatabaseSync): string[] {
  const rows = db.prepare("PRAGMA table_info(threads)").all() as {
    name: string;
  }[];
  const observed = new Set(rows.map((r) => r.name));
  return REQUIRED_THREAD_COLUMNS.filter((c) => !observed.has(c));
}

let loggedSchemaError = false;

/** Open a read-only connection to Codex's threads database. Returns null
 *  if the DB is absent (ENOENT silently; other errors at `error`) or if
 *  the `threads` table is missing required columns (logged loudly once).
 *  WAL mode is Codex's default, so a read-only connection coexists with
 *  Codex's own writes without blocking either side. Caller MUST close
 *  the returned database when done. */
export function openDb(log?: Logger): DatabaseSync | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(CODEX_DB_PATH, { readOnly: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    log?.debug({ err, path: CODEX_DB_PATH }, "codex db unavailable");
    return null;
  }
  let missing: string[];
  try {
    missing = missingThreadColumns(db);
  } catch (err) {
    db.close();
    if (!loggedSchemaError) {
      loggedSchemaError = true;
      log?.error(
        { err, path: CODEX_DB_PATH },
        "codex schema introspection failed — Codex detection disabled",
      );
    }
    return null;
  }
  if (missing.length > 0) {
    db.close();
    if (!loggedSchemaError) {
      loggedSchemaError = true;
      log?.error(
        {
          path: CODEX_DB_PATH,
          missing,
          required: REQUIRED_THREAD_COLUMNS,
        },
        "codex `threads` table is missing required columns — Codex detection disabled. Upstream may have bumped the schema; set KOLU_CODEX_DB to pin a known-good DB while a fix ships.",
      );
    }
    return null;
  }
  return db;
}

/**
 * Every live thread for a given directory, most recently updated FIRST.
 * Empty if no threads exist for that directory or the DB is absent.
 *
 * Filters:
 *  - `cwd = ?` — exact match on the thread's starting directory.
 *  - `source IN ('cli', 'vscode')` — includes standalone CLI threads and
 *    daemon-backed TUI threads, stored as `vscode` (observed from Codex 0.158)
 *    (the VS Code extension uses that source too). Excludes non-interactive
 *    `exec` and sub-agent JSON sources like `{"subagent":{"thread_spawn":...}}`:
 *    those are not interactive user sessions to bind to a foreground terminal.
 *  - `archived = 0` — excludes archived threads the user has dismissed.
 *
 * Order: `updated_at_ms DESC` — the active session first. It is a
 * PREFERENCE, not an answer: `cwd` is a property of the repository, not
 * of a terminal, so two Codex harnesses in one repo match this same list.
 * Answering with only the first row handed both of them the same thread
 * and their dock rows converged (juspay/kolu#2057); the orchestrator's
 * ownership arbiter walks the list and gives each terminal a thread of
 * its own. Mirrors OpenCode's `time_updated DESC` ordering.
 */
export function findSessionsByDirectory(
  directory: string,
  log?: Logger,
): CodexSession[] | null {
  return readDbList(
    openDb,
    (conn) =>
      (
        conn
          .prepare(
            `SELECT id, rollout_path FROM threads WHERE cwd = ? AND source IN ('cli', 'vscode') AND archived = 0 ORDER BY updated_at_ms DESC LIMIT ${MAX_CANDIDATES}`,
          )
          .all(directory) as { id: string; rollout_path: string }[]
      ).map((row) => ({
        id: row.id,
        rolloutPath: row.rollout_path,
        startedAt: uuidV7TimestampMs(row.id),
      })),
    "codex threads query failed",
    { directory },
    log,
  );
}

export interface ThreadMetadata {
  title: string | null;
  model: string | null;
}

/**
 * Re-read the mutable thread columns (title, model) from the DB.
 * Returns null if the row has been deleted (rare — only on Codex wipe)
 * or the DB is absent.
 */
export function getThreadMetadata(
  threadId: string,
  log?: Logger,
  db?: DatabaseSync,
): ThreadMetadata | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT title, model FROM threads WHERE id = ?")
        .get(threadId) as
        | { title: string | null; model: string | null }
        | undefined;
      if (!row) return null;
      return {
        title: row.title || null,
        model: row.model || null,
      };
    },
    "codex thread metadata query failed",
    { threadId },
    log,
    db,
  );
}

interface RolloutLine {
  type?: string;
  payload?: {
    type?: string;
    turn_id?: string;
    call_id?: string;
    name?: string;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
      };
    };
  };
}

function totalPromptTokensIncludingCache(entry: RolloutLine): number | null {
  if (entry.type !== "event_msg") return null;
  if (entry.payload?.type !== "token_count") return null;
  const total = entry.payload.info?.last_token_usage?.input_tokens;
  return typeof total === "number" ? total : null;
}

/** Codex function-call names whose pending invocation means the agent
 *  is awaiting the human. All three handlers `await session.<…>(…)` on
 *  the user before resolving:
 *   - `request_user_input` — structured multi-choice prompt (Plan mode
 *     only by default; gated on the `DefaultModeRequestUserInput`
 *     feature flag for Default mode — see
 *     `codex-rs/protocol/src/config_types.rs:593-595`).
 *   - `request_permissions` — model asks to escalate sandbox or
 *     filesystem permissions; available in all modes
 *     (`codex-rs/core/src/tools/handlers/request_permissions.rs:64`).
 *   - `request_plugin_install` — MCP-elicitation prompt to install a
 *     connector/plugin
 *     (`codex-rs/core/src/tools/handlers/request_plugin_install.rs:157`).
 */
const AWAITING_USER_TOOLS = new Set([
  "request_user_input",
  "request_permissions",
  "request_plugin_install",
]);

interface TurnState {
  lifecycle: "started" | "ended" | null;
  openCalls: ReadonlyMap<string, string>;
}

function foldRolloutEvents(lines: string[]): TurnState {
  let lifecycle: TurnState["lifecycle"] = null;
  const openCalls = new Map<string, string>();

  for (const line of lines) {
    let entry: RolloutLine;
    try {
      entry = JSON.parse(line) as RolloutLine;
    } catch {
      continue;
    }
    const outer = entry.type;
    const inner = entry.payload?.type;

    if (outer === "event_msg") {
      if (inner === "task_started" && entry.payload?.turn_id) {
        lifecycle = "started";
        openCalls.clear();
      } else if (
        (inner === "task_complete" || inner === "turn_aborted") &&
        entry.payload?.turn_id
      ) {
        lifecycle = "ended";
      }
    } else if (outer === "response_item") {
      if (inner === "function_call" && entry.payload?.call_id) {
        openCalls.set(entry.payload.call_id, entry.payload.name ?? "");
      } else if (inner === "function_call_output" && entry.payload?.call_id) {
        openCalls.delete(entry.payload.call_id);
      }
    }
  }

  return { lifecycle, openCalls };
}

export function parseRolloutState(lines: string[]): CodexInfo["state"] | null {
  const { lifecycle, openCalls } = foldRolloutEvents(lines);

  if (lifecycle === null) return null;
  if (lifecycle === "ended") return "waiting";
  if (openCalls.size === 0) return "thinking";
  let awaiting = 0;
  for (const name of openCalls.values()) {
    if (AWAITING_USER_TOOLS.has(name)) awaiting++;
  }
  return classifyByAwaiting(awaiting, openCalls.size);
}

export function parseRolloutContextTokens(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    let entry: RolloutLine;
    try {
      entry = JSON.parse(raw) as RolloutLine;
    } catch {
      continue;
    }
    const total = totalPromptTokensIncludingCache(entry);
    if (total === null) continue;
    return total > 0 ? total : null;
  }
  return null;
}
