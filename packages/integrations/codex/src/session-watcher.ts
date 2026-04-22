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
import { agentInfoEqual } from "anyagent";
import type { Logger } from "anyagent";
import {
  type CodexInfo,
  type CodexSession,
  getThreadMetadata,
  openDb,
  parseRolloutState,
  subscribeCodexDb,
} from "./index.ts";

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

    const state = deriveState(session.rolloutPath, session.id, log);
    // `null` covers three distinct cases — ENOENT race, hard read
    // error, or a parsed-but-turn-less rollout. Each is logged at the
    // failure site inside `deriveState` so the caller doesn't have to
    // reinvent the distinction here; from this layer, null uniformly
    // means "skip this refresh."
    if (state === null) return;

    const info: CodexInfo = {
      kind: "codex",
      state,
      sessionId: session.id,
      model: meta.model,
      summary: meta.title,
      taskProgress: null,
      contextTokens: meta.tokensUsed,
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

/** Read the last TAIL_BYTES of the rollout JSONL, drop any partial
 *  first line, and delegate to `parseRolloutState`. Returns null when
 *  no state is derivable — one of three distinct cases:
 *
 *   - **Rollout absent (ENOENT)** — expected race window between
 *     Codex inserting the thread row and flushing its first rollout
 *     append. Silent, no log (the next WAL event retries).
 *   - **Hard read failure (EACCES, EMFILE, EIO, …)** — logged at
 *     `error`. Operators filtering on >=error see it.
 *   - **Rollout present but no turns yet** — logged at `debug`
 *     scoped to this function so the caller doesn't emit a log that
 *     would be wrong under the hard-failure branch.
 *
 *  All three collapse to `null` at the call boundary because the
 *  caller's action is the same in each case (skip this refresh) —
 *  distinguishing them at the log level is the only signal an
 *  operator needs. `sessionId` is threaded in purely so the log lines
 *  carry it without the caller wrapping the call. */
function deriveState(
  rolloutPath: string,
  sessionId: string,
  log?: Logger,
): CodexInfo["state"] | null {
  let stat;
  try {
    stat = fs.statSync(rolloutPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: rolloutPath, session: sessionId },
        "codex rollout stat failed",
      );
    }
    return null;
  }

  const start = Math.max(0, stat.size - TAIL_BYTES);
  const toRead = Math.min(TAIL_BYTES, stat.size);
  const buf = Buffer.alloc(toRead);
  try {
    const fd = fs.openSync(rolloutPath, "r");
    try {
      fs.readSync(fd, buf, 0, toRead, start);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    log?.error(
      { err, path: rolloutPath, session: sessionId },
      "codex rollout read failed",
    );
    return null;
  }

  const text = buf.toString("utf8");
  const lines = text.split("\n").filter((l) => l.length > 0);
  // First line may be mid-JSON if we started partway through the file.
  // Only drop it when we didn't start from byte 0 — otherwise the first
  // line is `session_meta` and is intact.
  if (start > 0 && lines.length > 0) lines.shift();

  const state = parseRolloutState(lines);
  if (state === null) {
    log?.debug(
      { session: sessionId, path: rolloutPath },
      "codex rollout has no task events yet",
    );
  }
  return state;
}
