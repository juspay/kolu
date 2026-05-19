/**
 * Codex core — pure functions for detecting Codex sessions and deriving
 * state from its SQLite threads DB + per-session JSONL rollout transcripts.
 *
 * Every IO operation flows through an `Executor` — the controller's local
 * fs (`localExecutor`) for local terminals, the SSH `Host` for remote
 * ones. Same code, two backends.
 *
 * Codex stores:
 *  - `~/.codex/state_v<N>.sqlite` — authoritative thread metadata.
 *    The `<N>` is Codex's schema-version suffix; v5 today,
 *    `resolveCodexDbPath` picks the highest in HOME so a user who upgrades
 *    Codex past v5 isn't silently blind.
 *  - `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl` — per-thread
 *    append-only event log.
 *
 * Division of labor between SQLite and JSONL is unchanged from the
 * pre-refactor version — see the inline algorithm doc on
 * `parseRolloutState`.
 */

import { DatabaseSync } from "node:sqlite";
import type { Executor } from "anyagent";
import { classifyByAwaiting } from "anyagent";
import type { Logger } from "kolu-shared";
import { CODEX_DB_PATH, CODEX_DIR, findCodexStateDbPath } from "./config.ts";
import type { CodexInfo } from "./schemas.ts";

// --- DB path resolution ---

/** Resolve Codex's `state_v<N>.sqlite` path on this executor's filesystem.
 *  Walks `~/.codex/` for the highest-version `state_v<N>.sqlite` so users
 *  who upgrade Codex past v5 aren't silently blind.
 *
 *  Controller-side env overrides are honored first — `KOLU_CODEX_DB` for
 *  a direct DB path and `KOLU_CODEX_DIR` for a custom Codex root. Both
 *  short-circuit the executor-routed lookup; in production neither is
 *  set so the remote executor's `$HOME/.codex/` enumeration runs. Tests
 *  set `KOLU_CODEX_DIR` to a per-worker temp dir, and without honoring
 *  it here the executor.exec fallback walked the controller's real
 *  `$HOME/.codex/` and missed the fixture entirely. */
export async function resolveCodexDbPath(
  executor: Executor,
  log?: Logger,
): Promise<string | null> {
  if (process.env.KOLU_CODEX_DB) return process.env.KOLU_CODEX_DB;
  if (process.env.KOLU_CODEX_DIR) {
    return findCodexStateDbPath(process.env.KOLU_CODEX_DIR);
  }
  try {
    const r = await executor.exec(
      "sh",
      [
        "-c",
        // List state_v*.sqlite under ~/.codex/, pick highest version.
        'ls -1 "$HOME"/.codex/state_v*.sqlite 2>/dev/null | sort -V | tail -n 1',
      ],
      { timeoutMs: 5_000 },
    );
    if (r.exitCode !== 0) return null;
    const p = r.stdout.trim();
    return p || null;
  } catch (err) {
    log?.debug({ err }, "resolveCodexDbPath failed");
    return null;
  }
}

/** Resolve `~/.codex/` on this executor's filesystem. Used by
 *  `externalChanges.isPresent` to decide whether to install the WAL
 *  watcher at all. Same env-override priority as `resolveCodexDbPath`:
 *  `KOLU_CODEX_DIR` short-circuits to the controller-side override
 *  (which the test fixture sets to a per-worker temp dir) before
 *  falling through to the executor's `$HOME/.codex`. */
export async function resolveCodexDir(
  executor: Executor,
  log?: Logger,
): Promise<string | null> {
  if (process.env.KOLU_CODEX_DIR) return process.env.KOLU_CODEX_DIR;
  try {
    const r = await executor.exec("printenv", ["HOME"], { timeoutMs: 5_000 });
    if (r.exitCode !== 0) return null;
    const home = r.stdout.trim();
    if (!home) return null;
    return `${home}/.codex`;
  } catch (err) {
    log?.debug({ err }, "resolveCodexDir failed");
    return null;
  }
}

// --- Schema validation ---

/** Columns our SELECTs depend on. If Codex renames or drops any of these,
 *  the queries would silently return zero rows. */
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

/** Return the list of required columns missing from the `threads` table.
 *  Empty array when the schema matches. */
export async function missingThreadColumns(
  dbPath: string,
  executor: Executor,
  log?: Logger,
): Promise<string[]> {
  if (!executor.queryDb) return [];
  try {
    const rows = (await executor.queryDb(
      dbPath,
      "PRAGMA table_info(threads)",
      [],
    )) as Array<{ name: string }>;
    const observed = new Set(rows.map((r) => r.name));
    return REQUIRED_THREAD_COLUMNS.filter((c) => !observed.has(c));
  } catch (err) {
    log?.debug({ err, dbPath }, "codex schema introspection failed");
    return REQUIRED_THREAD_COLUMNS.slice();
  }
}

/** One-shot guard: has the schema-mismatch error been logged for this
 *  process? The mismatch can't resolve without a restart. */
let loggedSchemaError = false;

// --- Database session lookup ---

export interface CodexSession {
  /** Thread id (uuid v7). */
  id: string;
  /** Absolute path to the rollout JSONL on the executor's fs. */
  rolloutPath: string;
  /** Resolved DB path used to find this session. Stashed so the watcher
   *  doesn't have to re-resolve on every refresh. */
  dbPath: string;
}

/**
 * Find the most recently updated thread for a given directory. Filters:
 *  - `cwd = ?` — exact match on the thread's starting directory.
 *  - `source = 'cli'` — excludes Codex-spawned sub-agent threads.
 *  - `archived = 0` — excludes archived threads.
 */
export async function findSessionByDirectory(
  directory: string,
  executor: Executor,
  log?: Logger,
): Promise<CodexSession | null> {
  const dbPath = await resolveCodexDbPath(executor, log);
  if (!dbPath) return null;
  if (!executor.queryDb) return null;
  const missing = await missingThreadColumns(dbPath, executor, log);
  if (missing.length > 0) {
    if (!loggedSchemaError) {
      loggedSchemaError = true;
      log?.error(
        { path: dbPath, missing, required: REQUIRED_THREAD_COLUMNS },
        "codex `threads` table is missing required columns — Codex detection disabled.",
      );
    }
    return null;
  }
  try {
    const rows = (await executor.queryDb(
      dbPath,
      "SELECT id, rollout_path FROM threads WHERE cwd = ? AND source = 'cli' AND archived = 0 ORDER BY updated_at_ms DESC LIMIT 1",
      [directory],
    )) as Array<{ id: string; rollout_path: string }>;
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return { id: row.id, rolloutPath: row.rollout_path, dbPath };
  } catch (err) {
    log?.debug({ err, directory }, "codex threads query failed");
    return null;
  }
}

// --- Thread row refresh ---

export interface ThreadMetadata {
  title: string | null;
  model: string | null;
}

export async function getThreadMetadata(
  threadId: string,
  dbPath: string,
  executor: Executor,
  log?: Logger,
): Promise<ThreadMetadata | null> {
  if (!executor.queryDb) return null;
  try {
    const rows = (await executor.queryDb(
      dbPath,
      "SELECT title, model FROM threads WHERE id = ?",
      [threadId],
    )) as Array<{ title: string | null; model: string | null }>;
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return { title: row.title || null, model: row.model || null };
  } catch (err) {
    log?.debug({ err, threadId }, "codex thread metadata query failed");
    return null;
  }
}

// --- Local-only DB helper (transcript export) ---

/** Open the controller's local Codex DB read-only. Used by the one-shot
 *  HTML transcript exporter, which runs only against local sessions.
 *  The live agent-detection path goes through the executor instead. */
export function openDb(log?: Logger): DatabaseSync | null {
  try {
    return new DatabaseSync(CODEX_DB_PATH, { readOnly: true });
  } catch (err) {
    log?.debug({ err, path: CODEX_DB_PATH }, "codex db unavailable");
    return null;
  }
}

// --- JSONL state derivation (pure) ---

interface RolloutLine {
  type?: string;
  payload?: {
    type?: string;
    turn_id?: string;
    call_id?: string;
    name?: string;
    info?: { last_token_usage?: { input_tokens?: number } };
  };
}

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
      continue;
    }
    const outer = entry.type;
    const inner = entry.payload?.type;
    if (outer === "event_msg") {
      if (inner === "task_started" && entry.payload?.turn_id) {
        lastLifecycle = "started";
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
    return input > 0 ? input : null;
  }
  return null;
}

// --- Rollout tail reader ---

/** Read the last `maxBytes` of a rollout JSONL via the executor. Local
 *  uses fs read-with-offset under the hood (executor.readFile with
 *  truncate-from-tail semantics is the simplest portable shape); we just
 *  fetch the whole file capped at maxBytes from the END. For 256 KB
 *  tails over SSH that's a one-RPC round-trip. */
export async function readRolloutTail(
  rolloutPath: string,
  maxBytes: number,
  executor: Executor,
  log?: Logger,
): Promise<string[] | null> {
  try {
    // `tail -c <bytes>` is portable across GNU + BSD coreutils and
    // streams the right slice from disk without us having to track file
    // size + offset by hand. On both local (via execFile) and remote
    // (via helper exec) this returns the last maxBytes bytes of the
    // file as stdout.
    const r = await executor.exec(
      "tail",
      ["-c", String(maxBytes), rolloutPath],
      { timeoutMs: 10_000, maxBytes: maxBytes + 4096 },
    );
    if (r.exitCode !== 0) {
      log?.debug(
        { stderr: r.stderr, rolloutPath },
        "codex rollout tail failed",
      );
      return null;
    }
    // `tail -c <bytes>` returns the LAST <bytes> of the file. If the file
    // is larger than the window the slice begins mid-line, so the first
    // line is a partial that won't parse — drop it. If the file fits
    // entirely, the slice begins at the file's first byte, which (for
    // valid JSONL) is `{` — keep it. Detecting "complete vs. partial"
    // from the first character is enough to stop the small-file case
    // from silently dropping its only line.
    const all = r.stdout.split("\n");
    const start = all[0]?.startsWith("{") ? 0 : 1;
    const lines: string[] = [];
    for (let i = start; i < all.length; i++) {
      const l = all[i];
      if (l && l.length > 0) lines.push(l);
    }
    return lines;
  } catch (err) {
    log?.debug({ err, rolloutPath }, "codex rollout tail threw");
    return null;
  }
}

export { CODEX_DIR };
