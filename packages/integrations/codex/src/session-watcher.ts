/**
 * CodexWatcher — encapsulates all per-session lifecycle state.
 *
 * Creating a CodexWatcher subscribes to the shared WAL watcher and
 * emits state via the onChange callback. Destroying it unsubscribes,
 * clears the debounce timer, and closes the held DB connection.
 *
 * Data flow per WAL event:
 *   1. debounce 150 ms (coalesces bursts the way OpenCode does)
 *   2. re-read `threads.{title, model, tokens_used}` from SQLite
 *   3. tail the matched rollout JSONL (last TAIL_BYTES) and derive state
 *   4. assemble CodexInfo; emit only if structurally different from last
 *
 * Mirrors `OpenCodeWatcher` (SQLite side) composed with `SessionWatcher`
 * (JSONL tail side). The merge happens here because Codex is the one
 * integration where state lives only in the JSONL but metadata lives
 * only in SQLite — neither source is sufficient alone.
 */

import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "anyagent";
import { agentInfoEqual, readTailLines } from "anyagent";
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
  let lastInfo: CodexInfo | null = null;
  let destroyed = false;
  let debounceTimer: NodeJS.Timeout | null = null;
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

  // Hoist the DB connection across the watcher's lifetime so we don't
  // open/close on every WAL event. Safe in WAL mode: an open read-only
  // connection holds no locks until a transaction starts, and our
  // single-SELECT queries are autocommit.
  const db: DatabaseSync | null = openDb(log);

  function refresh() {
    if (destroyed || !db) return;

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
      return;
    }

    const stat = statRollout(session, log);
    if (stat === null) return;

    let state: CodexInfo["state"];
    let contextTokens: number | null;
    if (cachedDerive !== null && cachedDerive.size === stat.size) {
      state = cachedDerive.state;
      contextTokens = cachedDerive.contextTokens;
    } else {
      const derived = readAndParseTail(session, stat.size, log);
      if (derived === null) return;
      state = derived.state;
      contextTokens = derived.contextTokens;
      cachedDerive = { size: stat.size, state, contextTokens };
    }

    const info: CodexInfo = {
      kind: "codex",
      state,
      sessionId: session.id,
      model: meta.model,
      summary: meta.title,
      taskProgress: null,
      contextTokens,
    };

    if (agentInfoEqual(lastInfo, info)) return;
    lastInfo = info;
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

  /** Trailing-edge debounce: reset the timer on every event, fire
   *  `refresh` once after `WAL_DEBOUNCE_MS` of quiet. The handler's own
   *  `destroyed` guard makes late-firing callbacks safe, but we clear
   *  the timer in `destroy()` anyway to avoid holding closure refs
   *  unnecessarily. */
  function scheduleRefresh() {
    if (destroyed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      refresh();
    }, WAL_DEBOUNCE_MS);
  }

  const unsubscribe = subscribeCodexDb(
    scheduleRefresh,
    (err) => log?.error({ err, session: session.id }, "wal listener threw"),
    log,
  );
  refresh();

  return {
    session,
    destroy() {
      destroyed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      unsubscribe();
      db?.close();
    },
  };
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
 *  via anyagent's shared tail reader, then derive state and
 *  context-token count from the same buffer in two passes.
 *  Returns null on hard read error (logged at `error`) or when the
 *  state machine found no task events in the tail (logged at `debug`
 *  — the caller treats this uniformly as "skip"). `contextTokens`
 *  may independently be null when the tail contains a lifecycle
 *  event but no `token_count` event yet. */
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
