/**
 * Codex integration — pure functions and IO helpers for detecting
 * Codex sessions and deriving state from its SQLite threads DB +
 * per-session JSONL rollout transcripts.
 *
 * Codex stores:
 *  - `~/.codex/state_<N>.sqlite` — authoritative thread metadata.
 *    The `<N>` is Codex's schema-version suffix, currently v5;
 *    `findCodexStateDbPath` enumerates and picks the highest at startup
 *    so a user who upgrades Codex past v5 isn't silently blind. The
 *    `threads` table carries: id, rollout_path, cwd, title, tokens_used,
 *    model, updated_at_ms, source, archived.
 *  - `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl` — per-thread
 *    append-only event log. Each line is a typed event; the first line
 *    is `session_meta`, followed by a mix of `event_msg` (lifecycle:
 *    task_started, task_complete, token_count, thread_name_updated,
 *    exec_command_end) and `response_item` (assistant I/O:
 *    function_call, function_call_output, message, reasoning).
 *
 * Division of labor:
 *  - **SQLite** — session discovery (`findSessionByDirectory` joins
 *    cwd→thread in O(indexed-row-count)) and mutable metadata (title,
 *    model). Cheap indexed reads.
 *  - **JSONL** — state derivation (thinking / tool_use / waiting) and
 *    the per-turn context-token count. The SQLite row has no `state`
 *    column, and `threads.tokens_used` is a session-lifetime cumulative
 *    total (climbs to millions; unusable as a context-window percentage).
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

// --- Thread row refresh (title + model) ---

/** Fields the watcher re-reads from the DB on every WAL event. */
export interface ThreadMetadata {
  title: string | null;
  model: string | null;
}

/**
 * Re-read the mutable thread columns (title, model) from the DB.
 * Returns null if the row has been deleted (rare — only on Codex wipe)
 * or the DB is absent.
 *
 * NOTE — `threads.tokens_used` is NOT read here, even though it's a
 * tempting one-line SELECT. That column holds the SESSION-LIFETIME
 * cumulative total (`total_token_usage.total_tokens` summed across
 * every turn, including cache re-reads on each turn). For a
 * long-running session it can reach tens of millions — wildly larger
 * than the model's context window, and misleading as a "how close am
 * I to context exhaustion" signal. Current-turn context usage lives
 * in `info.last_token_usage` inside the rollout JSONL's latest
 * `token_count` event — see `parseRolloutContextTokens`.
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

// --- JSONL state derivation ---

/** Subset of a rollout line's shape that the parsers below read.
 *  Codex's actual records carry far more — we intentionally read only
 *  the fields the state machine + token accounting need, so unexpected
 *  additions upstream can't break parsing. */
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
    /** On `token_count` event_msgs. Nested because Codex envelopes the
     *  accounting under `.info` alongside rate-limit metadata. */
    info?: {
      /** Token usage for the MOST RECENT turn. In OpenAI's schema
       *  (which Codex follows), `input_tokens` is the TOTAL prompt
       *  the model saw — new + cached together — and matches what
       *  Codex's own `/status` command calls "used" context. Do NOT
       *  add `cached_input_tokens` on top: it's a breakdown showing
       *  what portion of `input_tokens` was a cache hit, not an
       *  additional count.
       *
       *  Contrast with Anthropic's schema (which claude-code reads):
       *  there, `input_tokens` / `cache_creation_input_tokens` /
       *  `cache_read_input_tokens` are DISJOINT buckets and summed.
       *  Mapping Anthropic's sum-three-fields pattern onto OpenAI's
       *  schema double-counts the cached portion. */
      last_token_usage?: {
        input_tokens?: number;
      };
    };
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
 *  2. Track open function calls by `call_id` **scoped to the current
 *     turn**: add on `function_call`, remove on `function_call_output`,
 *     clear on `task_started`. Scoping matters — a `function_call` from
 *     a prior turn that never got a matching `function_call_output`
 *     (user aborted mid-tool, or tail head clipped the output) would
 *     otherwise pin state at `tool_use` forever into the next turn.
 *     `exec_command_end` is ignored — it carries a call_id but is a
 *     mid-tool event; the call stays open until its
 *     `function_call_output` arrives.
 *  3. Decide:
 *     - No lifecycle events seen → null (fresh thread, suppress badge).
 *     - Last lifecycle event was `task_complete` → **waiting**.
 *     - Last lifecycle event was `task_started` + any call_id open
 *       **for the current turn** → **tool_use**.
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
        // Scope openCalls to the current turn — see algorithm doc.
        openCalls.clear();
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

/**
 * Find the CURRENT-TURN context-window token count in the rollout
 * JSONL's tail — `info.last_token_usage.input_tokens` from the latest
 * `token_count` event.
 *
 * Why `input_tokens` alone? In OpenAI's API (which Codex emits),
 * `input_tokens` is the TOTAL prompt the model saw this turn —
 * already inclusive of any cached portion. `cached_input_tokens` is a
 * breakdown of that total, not an additional count. Adding the two
 * would double-count every cache hit; Codex's own `/status` command
 * shows exactly this field as "context used" against the window.
 *
 * Why not `threads.tokens_used` (the SQLite column)? That's the
 * session-lifetime cumulative `total_token_usage.total_tokens` —
 * summed across every turn, climbing into millions on long sessions,
 * dwarfing the 258 K context window and giving nonsense percentages.
 *
 * Walks backward so the first matching event wins; returns null if no
 * `token_count` event is in the tail (fresh thread, or token_count
 * scrolled off a long transcript before the next one landed).
 */
export function parseRolloutContextTokens(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: RolloutLine;
    try {
      entry = JSON.parse(lines[i]!) as RolloutLine;
    } catch {
      continue;
    }
    if (entry.type !== "event_msg") continue;
    if (entry.payload?.type !== "token_count") continue;
    const input = entry.payload.info?.last_token_usage?.input_tokens;
    if (typeof input !== "number") continue;
    // 0 means the event landed before the first assistant turn
    // accounted (empty placeholder) — render as "not yet" rather than
    // "0 tokens used."
    return input > 0 ? input : null;
  }
  return null;
}

// --- Session watcher (encapsulates per-session lifecycle) ---

export { createCodexWatcher, type CodexWatcher } from "./session-watcher.ts";

// --- Shared WAL watcher ---

export { subscribeCodexDb } from "./wal-watcher.ts";

// --- AgentProvider instance ---

export { codexProvider } from "./agent-provider.ts";
