/**
 * OpenCodeWatcher — encapsulates all per-session lifecycle state.
 *
 * Creating an OpenCodeWatcher subscribes to the shared WAL watcher and
 * emits state via the onChange callback. Destroying it unsubscribes and
 * closes the held DB connection. No "remember to reset N variables"
 * invariant — the lifetime IS the object.
 *
 * The server's opencode provider creates one of these per matched session
 * and replaces it on session change. Mirrors the SessionWatcher pattern
 * from `kolu-claude-code` (PR #437).
 */

import type { DatabaseSync } from "node:sqlite";
import {
  type OpenCodeInfo,
  type OpenCodeSession,
  type TaskProgress,
  deriveSessionState,
  getSessionTaskProgress,
  openDb,
  subscribeOpenCodeDb,
} from "./index.ts";

// --- Logger interface (shared across the package) ---

type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

// --- Tuning constants ---

/** Trailing-edge debounce for WAL fs.watch callbacks. OpenCode streams
 *  parts during generation, and Linux fs.watch fires multiple events per
 *  write — without debouncing, `refresh` runs dozens of times per second
 *  during active use, each call running two SQL queries. 150 ms coalesces
 *  bursts into one handler run while keeping user-perceptible lag
 *  imperceptible. Matches TRANSCRIPT_DEBOUNCE_MS in kolu-claude-code. */
const WAL_DEBOUNCE_MS = 150;

// --- Equality ---

/** Compare two TaskProgress values for equality. */
function taskProgressEqual(
  a: TaskProgress | null,
  b: TaskProgress | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.total === b.total && a.completed === b.completed;
}

/** Compare two OpenCodeInfo values for equality. */
export function infoEqual(
  a: OpenCodeInfo | null,
  b: OpenCodeInfo | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.sessionId === b.sessionId &&
    a.model === b.model &&
    a.summary === b.summary &&
    taskProgressEqual(a.taskProgress, b.taskProgress)
  );
}

// --- Watcher ---

export interface OpenCodeWatcher {
  readonly session: OpenCodeSession;
  destroy(): void;
}

/**
 * Start watching an OpenCode session. Reads the latest message immediately
 * and emits an initial state, then re-reads on every WAL file change
 * (debounced) and emits a new state if it differs from the last one.
 *
 * `onChange` is called with the full OpenCodeInfo each time state changes.
 * The caller is responsible for forwarding it to the metadata system.
 */
export function createOpenCodeWatcher(
  session: OpenCodeSession,
  onChange: (info: OpenCodeInfo) => void,
  log?: Logger,
): OpenCodeWatcher {
  let lastInfo: OpenCodeInfo | null = null;
  let destroyed = false;
  // Trailing-edge debounce timer for WAL fs.watch events.
  // Null when idle. Cleared on destroy.
  let debounceTimer: NodeJS.Timeout | null = null;

  // Hoist the DB connection across the watcher's lifetime so we don't
  // open/close on every WAL event. Safe in WAL mode: an open connection
  // holds no locks until you start a transaction, and our queries are
  // autocommit. See README's OpenCode Status section for the full
  // locking analysis.
  const db: DatabaseSync | null = openDb(log);

  function refresh() {
    if (destroyed || !db) return;
    const derived = deriveSessionState(session.id, log, db);
    if (!derived) {
      log?.debug(
        { session: session.id },
        "no messages yet for opencode session",
      );
      return;
    }

    const taskProgress = getSessionTaskProgress(session.id, log, db);

    const info: OpenCodeInfo = {
      kind: "opencode",
      state: derived.state,
      sessionId: session.id,
      model: derived.model,
      summary: session.title,
      taskProgress,
    };

    if (infoEqual(lastInfo, info)) return;
    lastInfo = info;
    log?.debug(
      { state: info.state, model: info.model, session: info.sessionId },
      "opencode state updated",
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

  const unsubscribe = subscribeOpenCodeDb(
    scheduleRefresh,
    (err) => log?.warn({ err, session: session.id }, "wal listener threw"),
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
