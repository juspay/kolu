/**
 * Codex core — pure functions and IO helpers for detecting Codex sessions
 * and deriving state from its SQLite threads DB + per-session JSONL rollout
 * transcripts.
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
 *
 * Structure note: this file holds the leaf module. Peers `session-watcher.ts`,
 * `wal-watcher.ts`, and `agent-provider.ts` import from here; `index.ts` is
 * a pure barrel re-exporting from all of them plus `schemas.ts` / `config.ts`.
 */

import { DatabaseSync } from "node:sqlite";
import { classifyByAwaiting } from "anyagent";
import type { Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { CODEX_DB_PATH } from "./config.ts";
import type { CodexInfo } from "./schemas.ts";

// --- Database helpers ---

// --- Database session lookup ---

export interface CodexSession {
  /** Thread id (uuid v7). */
  id: string;
  /** Absolute path to the rollout JSONL — copied from the DB row at
   *  match time so the watcher doesn't re-query to locate its file. */
  rolloutPath: string;
  dbPath: string;
  walPath: string;
}

/** Columns our SELECTs depend on. If Codex renames or drops any of
 *  these, the queries would silently return zero rows, leaving the user
 *  with no Codex badge and no indication why. Keep this list in sync
 *  with `findSessionByDirectory` (id, rollout_path, cwd, source,
 *  archived, updated_at_ms) and `getThreadMetadata` (title, model). */
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

/** Local transcript-export path. Provider/watch runtime uses Executor. */
export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(CODEX_DB_PATH, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: CODEX_DB_PATH }, "codex db unavailable");
    return null;
  }
}

/** One-shot guard: has openDb already logged a schema-mismatch error
 *  for this process? The mismatch can't resolve without a restart
 *  (CODEX_DB_PATH is resolved once at module load), so re-logging on
 *  every openDb call would be noise. */
let loggedSchemaError = false;

export interface CodexPaths {
  dir: string;
  dbPath: string;
  walPath: string;
}

export async function resolveCodexPaths(
  executor: Executor,
  log?: Logger,
): Promise<CodexPaths | null> {
  if (process.env.KOLU_CODEX_DB) {
    return {
      dir: process.env.KOLU_CODEX_DIR ?? "",
      dbPath: process.env.KOLU_CODEX_DB,
      walPath: `${process.env.KOLU_CODEX_DB}-wal`,
    };
  }
  let dir = process.env.KOLU_CODEX_DIR;
  if (!dir) {
    const home = await executor.exec("printenv", ["HOME"], {
      timeoutMs: 5_000,
      maxBytes: 4096,
    });
    if (home.exitCode !== 0 || !home.stdout.trim()) return null;
    dir = `${home.stdout.trim()}/.codex`;
  }
  let bestVersion = -1;
  let bestFile: string | null = null;
  try {
    const ls = await executor.exec("ls", ["-1", dir], {
      timeoutMs: 10_000,
      maxBytes: 1024 * 1024,
    });
    if (ls.exitCode === 0) {
      for (const name of ls.stdout.split("\n")) {
        const versionText = /^state_(\d+)\.sqlite$/.exec(name)?.[1];
        if (!versionText) continue;
        const version = Number.parseInt(versionText, 10);
        if (version > bestVersion) {
          bestVersion = version;
          bestFile = name;
        }
      }
    }
  } catch (err) {
    log?.debug({ err, dir }, "codex state db enumeration failed");
  }
  const dbPath = `${dir}/${bestFile ?? "state_5.sqlite"}`;
  return { dir, dbPath, walPath: `${dbPath}-wal` };
}

async function queryDb(
  executor: Executor,
  dbPath: string,
  sql: string,
  params: ReadonlyArray<string | number | null>,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
): Promise<Array<Record<string, unknown>> | null> {
  if (!executor.queryDb) {
    log?.error({ dbPath, ...errorCtx }, "executor does not support queryDb");
    return null;
  }
  try {
    return await executor.queryDb(dbPath, sql, params);
  } catch (err) {
    log?.debug({ err, dbPath, ...errorCtx }, errorMsg);
    return null;
  }
}

function missingThreadColumnsFromRows(
  rows: Array<Record<string, unknown>>,
): string[] {
  const observed = new Set(
    rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
  return REQUIRED_THREAD_COLUMNS.filter((c) => !observed.has(c));
}

async function ensureThreadSchema(
  executor: Executor,
  dbPath: string,
  log?: Logger,
): Promise<boolean> {
  const rows = await queryDb(
    executor,
    dbPath,
    "PRAGMA table_info(threads)",
    [],
    "codex schema introspection failed — Codex detection disabled",
    {},
    log,
  );
  if (rows === null) return false;
  const missing = missingThreadColumnsFromRows(rows);
  if (missing.length > 0) {
    if (!loggedSchemaError) {
      loggedSchemaError = true;
      log?.error(
        {
          path: dbPath,
          missing,
          required: REQUIRED_THREAD_COLUMNS,
        },
        "codex `threads` table is missing required columns — Codex detection disabled. Upstream may have bumped the schema; set KOLU_CODEX_DB to pin a known-good DB while a fix ships.",
      );
    }
    return false;
  }
  return true;
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
export async function findSessionByDirectory(
  directory: string,
  executor: Executor,
  log?: Logger,
): Promise<CodexSession | null> {
  const paths = await resolveCodexPaths(executor, log);
  if (!paths) return null;
  if (!(await ensureThreadSchema(executor, paths.dbPath, log))) return null;
  const rows = await queryDb(
    executor,
    paths.dbPath,
    "SELECT id, rollout_path FROM threads WHERE cwd = ? AND source = 'cli' AND archived = 0 ORDER BY updated_at_ms DESC LIMIT 1",
    [directory],
    "codex threads query failed",
    { directory },
    log,
  );
  const row = rows?.[0];
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.rollout_path !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    rolloutPath: row.rollout_path,
    dbPath: paths.dbPath,
    walPath: paths.walPath,
  };
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
export async function getThreadMetadata(
  threadId: string,
  executor: Executor,
  dbPath: string,
  log?: Logger,
): Promise<ThreadMetadata | null> {
  const rows = await queryDb(
    executor,
    dbPath,
    "SELECT title, model FROM threads WHERE id = ?",
    [threadId],
    "codex thread metadata query failed",
    { threadId },
    log,
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    title: typeof row.title === "string" && row.title ? row.title : null,
    model: typeof row.model === "string" && row.model ? row.model : null,
  };
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
    /** Function-call name on `response_item:function_call` payloads
     *  (e.g. `shell`, `request_user_input`, `update_plan`). */
    name?: string;
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
 *  Policy lives in `classifyByAwaiting`. */
const AWAITING_USER_TOOLS = new Set([
  "request_user_input",
  "request_permissions",
  "request_plugin_install",
]);

export function parseRolloutState(lines: string[]): CodexInfo["state"] | null {
  let lastLifecycle: "started" | "completed" | null = null;
  const openCalls = new Map<string, string>();

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
        openCalls.set(entry.payload.call_id, entry.payload.name ?? "");
      } else if (inner === "function_call_output" && entry.payload?.call_id) {
        openCalls.delete(entry.payload.call_id);
      }
    }
  }

  if (lastLifecycle === null) return null;
  if (lastLifecycle === "completed") return "waiting";
  if (openCalls.size === 0) return "thinking";
  let awaiting = 0;
  for (const name of openCalls.values()) {
    if (AWAITING_USER_TOOLS.has(name)) awaiting++;
  }
  return classifyByAwaiting(awaiting, openCalls.size);
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
    const raw = lines[i];
    if (raw === undefined) continue;
    let entry: RolloutLine;
    try {
      entry = JSON.parse(raw) as RolloutLine;
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
