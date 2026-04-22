/**
 * Codex integration — pure functions and IO helpers for detecting
 * Codex sessions and deriving state from its SQLite threads DB +
 * per-session JSONL rollout transcripts.
 *
 * Codex stores:
 *  - `~/.codex/state_5.sqlite` — authoritative thread metadata
 *    (`threads` table): id, rollout_path, cwd, title, tokens_used,
 *    model, updated_at_ms, source, archived.
 *  - `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl` — per-thread
 *    append-only event log. Each line is a typed event; the first line
 *    is `session_meta`, followed by a mix of `event_msg` (lifecycle:
 *    task_started, task_complete, token_count, thread_name_updated,
 *    exec_command_end) and `response_item` (assistant I/O:
 *    function_call, function_call_output, message, reasoning).
 *
 * Division of labor:
 *  - **SQLite is the primary source.** Session discovery, title, model,
 *    and context-token count all come from indexed column reads.
 *    `findSessionByDirectory` joins cwd→thread in O(indexed-row-count).
 *    `tokens_used` is pre-summed by Codex, so no JSON parsing needed.
 *  - **JSONL is used only for state derivation** (thinking / tool_use /
 *    waiting). The SQLite row has no `state` column — those transitions
 *    live exclusively in the event stream. See `parseRolloutState`.
 *
 * The two sources are written atomically in the same cycle (verified:
 * WAL and JSONL mtimes agree to the nanosecond), so one fs.watch on the
 * WAL covers both.
 */

import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { withDb as sharedWithDb } from "anyagent";
import { CODEX_DB_PATH } from "./config.ts";

// Re-export config so consumers can reference it (e.g. for env override docs).
export { CODEX_DIR, CODEX_DB_PATH, CODEX_DB_WAL_PATH } from "./config.ts";

// --- Codex schemas (single source of truth) ---

export { TaskProgressSchema, type TaskProgress, type Logger } from "anyagent";
import { TaskProgressSchema, type TaskProgress, type Logger } from "anyagent";

export const CodexInfoSchema = z.object({
  kind: z.literal("codex"),
  /** Current state derived from the rollout JSONL's event stream. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Thread id from Codex's `threads` table (e.g. "019db605-..."). */
  sessionId: z.string(),
  /** Model identifier from the DB (e.g. "gpt-5.4"). Null until Codex
   *  writes the first turn_context. */
  model: z.string().nullable(),
  /** Thread display title from the DB. Codex seeds this with the first
   *  user message, then replaces with a short generated name after
   *  the first exchange. */
  summary: z.string().nullable(),
  /** Codex has no TodoWrite equivalent — the `task_started`/`task_complete`
   *  events are per-turn lifecycle, not user-facing checklists.
   *  Permanently null; the field is kept for union shape uniformity. */
  taskProgress: TaskProgressSchema.nullable(),
  /** Running context-window token count from `threads.tokens_used` —
   *  pre-summed by Codex from the latest `token_count` event's
   *  `info.total_token_usage.total_tokens`. Null on a brand-new thread
   *  before the first assistant turn accounts. */
  contextTokens: z.number().nullable(),
});

export type CodexInfo = z.infer<typeof CodexInfoSchema>;

// --- Database helpers ---

/** Codex-specific `withDb` — partial application of anyagent's shared
 *  helper over our `openDb`. Callers stay unaware that the machinery
 *  lives upstream; they just get the same `(fn, errorMsg, errorCtx,
 *  log?, db?) → T | null` signature they had before. */
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

export interface CodexSession {
  /** Thread id (uuid v7). */
  id: string;
  /** Absolute path to the rollout JSONL — copied from the DB row at
   *  match time so the watcher doesn't re-query to locate its file. */
  rolloutPath: string;
}

/** Open a read-only connection to Codex's threads database. Returns null
 *  if absent. WAL mode is Codex's default, so a read-only connection
 *  coexists with Codex's own writes without blocking either side.
 *  Caller MUST close the returned database when done. */
export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(CODEX_DB_PATH, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: CODEX_DB_PATH }, "codex db unavailable");
    return null;
  }
}

/**
 * Find the most recently updated thread for a given directory.
 * Returns null if no threads exist for that directory or the DB is absent.
 *
 * Filters:
 *  - `cwd = ?` — exact match on the thread's starting directory.
 *  - `source = 'cli'` — excludes Codex-spawned sub-agent threads,
 *    whose `source` column is a JSON blob like
 *    `{"subagent":{"thread_spawn":...}}`. Those are not user sessions;
 *    they have no foreground terminal to bind to.
 *  - `archived = 0` — excludes archived threads the user has dismissed.
 *
 * Order: `updated_at_ms DESC` to pick the active session when multiple
 * live threads share a cwd. Mirrors OpenCode's `time_updated DESC`
 * heuristic.
 */
export function findSessionByDirectory(
  directory: string,
  log?: Logger,
): CodexSession | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare(
          "SELECT id, rollout_path FROM threads WHERE cwd = ? AND source = 'cli' AND archived = 0 ORDER BY updated_at_ms DESC LIMIT 1",
        )
        .get(directory) as { id: string; rollout_path: string } | undefined;
      if (!row) return null;
      return {
        id: row.id,
        rolloutPath: row.rollout_path,
      };
    },
    "codex threads query failed",
    { directory },
    log,
  );
}

// --- Thread row refresh (title + model + tokens_used) ---

/** Fields the watcher re-reads from the DB on every WAL event.
 *  Scoped to the three columns that actually vary over a thread's
 *  lifetime — everything else is set at thread creation. */
export interface ThreadMetadata {
  title: string | null;
  model: string | null;
  tokensUsed: number | null;
}

/**
 * Re-read the mutable thread columns (title, model, tokens_used) from
 * the DB. Returns null if the row has been deleted (rare — only on
 * Codex wipe) or the DB is absent.
 *
 * Codex maintains these columns itself from JSONL events:
 *   - title: latest `thread_name_updated` event's `thread_name`, or the
 *     first user message as a fallback.
 *   - model: latest `turn_context.payload.model`.
 *   - tokens_used: latest `token_count.info.total_token_usage.total_tokens`.
 *
 * So Kolu doesn't need to parse the JSONL for any of this — one indexed
 * lookup by primary key on every WAL event suffices.
 */
export function getThreadMetadata(
  threadId: string,
  log?: Logger,
  db?: DatabaseSync,
): ThreadMetadata | null {
  return withDb(
    (conn) => {
      const row = conn
        .prepare("SELECT title, model, tokens_used FROM threads WHERE id = ?")
        .get(threadId) as
        | { title: string | null; model: string | null; tokens_used: number }
        | undefined;
      if (!row) return null;
      return {
        title: row.title || null,
        model: row.model || null,
        // Codex writes tokens_used=0 for a thread that has had no
        // assistant turn yet. Normalize to null so the UI can render
        // "—" rather than "0k" before the first accounting.
        tokensUsed: row.tokens_used > 0 ? row.tokens_used : null,
      };
    },
    "codex thread metadata query failed",
    { threadId },
    log,
    db,
  );
}

// --- JSONL state derivation ---

/** Subset of a rollout line's shape that `parseRolloutState` reads.
 *  Codex's actual records carry far more — we intentionally read only
 *  the fields the state machine needs, so unexpected additions upstream
 *  can't break parsing. */
interface RolloutLine {
  type?: string;
  payload?: {
    type?: string;
    /** On `task_started` / `task_complete` event_msgs. Carried here
     *  only so we can use its presence as the "this is a real event"
     *  gate — its value is not needed by the state machine (Codex
     *  guarantees task_complete follows task_started for the same
     *  turn, so "last lifecycle signal was a complete" is sufficient
     *  without matching ids). */
    turn_id?: string;
    /** On `response_item` payloads for function_call/function_call_output. */
    call_id?: string;
  };
}

/**
 * Derive Codex state from the rollout JSONL's tail.
 *
 * Algorithm (single forward pass, O(lines)):
 *  1. Track the kind of the latest `task_started`/`task_complete`
 *     lifecycle event seen. Turn ids are NOT matched across events:
 *     whatever the last lifecycle event was dictates the outcome —
 *     this handles a tail that captured only `task_complete` without
 *     its matching `task_started` (long tool-heavy turns that exceed
 *     TAIL_BYTES).
 *  2. Track open function calls by `call_id`: add on `function_call`,
 *     remove on `function_call_output`. `exec_command_end` is ignored —
 *     it carries a call_id but is a mid-tool event; the call stays open
 *     until its `function_call_output` arrives.
 *  3. Decide:
 *     - No lifecycle events seen → null (fresh thread, suppress badge).
 *     - Last lifecycle event was `task_complete` → **waiting**.
 *     - Last lifecycle event was `task_started` + any call_id open →
 *       **tool_use**.
 *     - Last lifecycle event was `task_started` + no open calls →
 *       **thinking**.
 *
 * Pure function — unit-testable without touching the filesystem.
 */
export function parseRolloutState(lines: string[]): CodexInfo["state"] | null {
  let lastLifecycle: "started" | "completed" | null = null;
  const openCalls = new Set<string>();

  for (const line of lines) {
    let entry: RolloutLine;
    try {
      entry = JSON.parse(line) as RolloutLine;
    } catch {
      // Skip malformed lines — Codex writes well-formed JSONL, but a
      // truncated final write during tail read is possible.
      continue;
    }
    const outer = entry.type;
    const inner = entry.payload?.type;

    if (outer === "event_msg") {
      if (inner === "task_started" && entry.payload?.turn_id) {
        lastLifecycle = "started";
      } else if (inner === "task_complete" && entry.payload?.turn_id) {
        lastLifecycle = "completed";
      }
    } else if (outer === "response_item") {
      if (inner === "function_call" && entry.payload?.call_id) {
        openCalls.add(entry.payload.call_id);
      } else if (inner === "function_call_output" && entry.payload?.call_id) {
        openCalls.delete(entry.payload.call_id);
      }
    }
  }

  if (lastLifecycle === null) return null;
  if (lastLifecycle === "completed") return "waiting";
  if (openCalls.size > 0) return "tool_use";
  return "thinking";
}

// --- Session watcher (encapsulates per-session lifecycle) ---

export { createCodexWatcher, type CodexWatcher } from "./session-watcher.ts";

// --- Shared WAL watcher ---

export { subscribeCodexDb } from "./wal-watcher.ts";

// --- AgentProvider instance ---

export { codexProvider } from "./agent-provider.ts";
