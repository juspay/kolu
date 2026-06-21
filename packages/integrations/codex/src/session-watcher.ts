/**
 * CodexWatcher — encapsulates all per-session lifecycle state.
 *
 * Wraps `kolu-shared`'s generic `createDebounceWatcher` with codex's
 * SQLite + JSONL refresh logic. The factory owns the destroy flag,
 * debounce timer, DB lifetime, equality-gated dispatch, and lifecycle
 * logs; this file only owns the per-event `refresh` body and codex's
 * `cachedDerive` JSONL-tail short-circuit.
 *
 * Data flow per WAL event (inside the factory's debounce):
 *   1. re-read `threads.{title, model, tokens_used}` from SQLite
 *   2. tail the matched rollout JSONL (last TAIL_BYTES) — skipped when
 *      the file size is unchanged from the last parse
 *   3. assemble CodexInfo; the factory gates dispatch on `agentInfoEqual`
 *
 * Mirrors `OpenCodeWatcher` (SQLite side) composed with `SessionWatcher`
 * (JSONL tail side). The merge happens here because Codex is the one
 * integration where state lives only in the JSONL but metadata lives
 * only in SQLite — neither source is sufficient alone.
 */

import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { agentInfoEqual } from "anyagent";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import { createDebounceWatcher } from "kolu-shared/sqlite";
import {
  type CodexSession,
  getThreadMetadata,
  openDb,
  parseRolloutContextTokens,
  parseRolloutState,
} from "./core.ts";
import type { CodexInfo } from "./schemas.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";

// --- Tuning constants ---

/** Trailing-edge debounce for WAL fs.watch callbacks. Codex writes a
 *  WAL frame and appends a JSONL line on every thread mutation; during
 *  active generation these fire several times per second. 150 ms
 *  coalesces bursts into one handler run while staying imperceptible.
 *  Matches WAL_DEBOUNCE_MS in kolu-opencode and TRANSCRIPT_DEBOUNCE_MS
 *  in kolu-claude-code. */
const WAL_DEBOUNCE_MS = 150;

/** Tail window for reading the rollout JSONL. Matches kolu-claude-code's
 *  TAIL_BYTES — sized to comfortably contain the last few turns
 *  (task_started → agent_message → task_complete plus any tool calls).
 *  Codex rollout lines are smaller than Claude's (assistant content is
 *  split into many `response_item` records rather than one monolithic
 *  `assistant` entry), so 256 KB is generous. */
const TAIL_BYTES = 256 * 1024;

// --- Watcher ---

export interface CodexWatcher {
  readonly session: CodexSession;
  destroy(): void;
}

/**
 * Start watching a Codex session. Reads current state immediately and
 * emits an initial CodexInfo, then re-reads on every WAL file change
 * (debounced) and emits a new info if it differs from the last one.
 *
 * `onChange` is called with the full CodexInfo each time state changes.
 * The caller forwards it to the metadata system.
 */
export function createCodexWatcher(
  session: CodexSession,
  onChange: (info: CodexInfo) => void,
  log?: Logger,
): CodexWatcher {
  /** Cache of the last-parsed rollout state + context-token count,
   *  scoped to a specific JSONL byte size. On a WAL event whose
   *  corresponding stat size matches `size`, we reuse the cached
   *  values instead of re-reading and re-parsing the tail. Null
   *  until the first successful derive.
   *
   *  This is the hot-path optimization: DB-only WAL events (e.g.
   *  title updates, row touches) don't append to the rollout, so
   *  `state` and `contextTokens` can't have changed. Without the
   *  short-circuit, we'd re-read + re-parse 256 KB on every such
   *  fire. */
  let cachedDerive: {
    size: number;
    state: CodexInfo["state"];
    contextTokens: number | null;
  } | null = null;

  function refresh(db: DatabaseSync): CodexInfo | null {
    const meta = getThreadMetadata(session.id, log, db);
    if (!meta) {
      // The row existed at match time (otherwise we wouldn't have a
      // CodexSession at all) — a null here means Codex deleted it
      // after we subscribed. That's a real anomaly, not a race window,
      // so it warrants `warn`, not `debug`. Conflating it with the
      // expected "no turns yet" path below would hide the distinction
      // from an operator filtering logs.
      log?.warn(
        { session: session.id },
        "codex thread row disappeared after match",
      );
      return null;
    }

    const stat = statRollout(session, log);
    if (stat === null) return null;

    let state: CodexInfo["state"];
    let contextTokens: number | null;
    if (cachedDerive !== null && cachedDerive.size === stat.size) {
      state = cachedDerive.state;
      contextTokens = cachedDerive.contextTokens;
    } else {
      const derived = readAndParseTail(session, stat.size, log);
      if (derived === null) return null;
      state = derived.state;
      contextTokens = derived.contextTokens;
      cachedDerive = { size: stat.size, state, contextTokens };
    }

    return {
      kind: "codex",
      state,
      sessionId: session.id,
      model: meta.model,
      summary: meta.title,
      taskProgress: null,
      contextTokens,
      startedAt: session.startedAt,
    };
  }

  function logAndDispatch(info: CodexInfo): void {
    log?.debug(
      {
        state: info.state,
        model: info.model,
        session: info.sessionId,
        tokens: info.contextTokens,
      },
      "codex state updated",
    );
    onChange(info);
  }

  // Hoist the DB connection across the watcher's lifetime so we don't
  // open/close on every WAL event. Safe in WAL mode: an open read-only
  // connection holds no locks until a transaction starts, and our
  // single-SELECT queries are autocommit.
  const db = openDb(log);

  return createDebounceWatcher({
    session,
    label: "codex: session",
    debounceMs: WAL_DEBOUNCE_MS,
    db,
    subscribe: subscribeCodexDb,
    refresh,
    isEqual: agentInfoEqual,
    onChange: logAndDispatch,
    logCtx: { session: session.id },
    log,
  });
}

/** Stat the rollout JSONL. Returns `{ size }` on success, null on any
 *  failure (ENOENT silently; other errnos at `error`). Split out from
 *  the parse step so the caller can use the size as a cache key — if
 *  it matches the last-parsed size, the expensive open/read/parse pass
 *  can be skipped entirely. */
function statRollout(
  session: CodexSession,
  log?: Logger,
): { size: number } | null {
  try {
    return { size: fs.statSync(session.rolloutPath).size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.rolloutPath, session: session.id },
        "codex rollout stat failed",
      );
    }
    return null;
  }
}

/** Read the last TAIL_BYTES of the rollout JSONL at the given size
 *  via kolu-shared's tail reader, then derive state and context-token
 *  count from the same buffer in two passes. Returns null on hard read
 *  error (logged at `error`) or when the state machine found no task
 *  events in the tail (logged at `debug` — the caller treats this
 *  uniformly as "skip"). `contextTokens` may independently be null
 *  when the tail contains a lifecycle event but no `token_count`
 *  event yet. */
function readAndParseTail(
  session: CodexSession,
  size: number,
  log?: Logger,
): { state: CodexInfo["state"]; contextTokens: number | null } | null {
  const lines = readTailLines({
    path: session.rolloutPath,
    size,
    maxBytes: TAIL_BYTES,
    onError: (err) =>
      log?.error(
        { err, path: session.rolloutPath, session: session.id },
        "codex rollout read failed",
      ),
  });
  if (lines === null) return null;

  const state = parseRolloutState(lines);
  if (state === null) {
    log?.debug(
      { session: session.id, path: session.rolloutPath },
      "codex rollout has no task events yet",
    );
    return null;
  }
  return { state, contextTokens: parseRolloutContextTokens(lines) };
}
