/**
 * CodexWatcher — encapsulates all per-session lifecycle state.
 *
 * Creating a CodexWatcher subscribes to the shared WAL watcher and
 * emits state via the onChange callback. Destroying it unsubscribes and
 * closes the held DB connection. No "remember to reset N variables"
 * invariant — the lifetime IS the object.
 *
 * The server's codex provider creates one of these per matched session
 * and replaces it on session change. Mirrors the SessionWatcher pattern
 * from `kolu-claude-code` and `kolu-opencode`.
 */

import type { DatabaseSync } from "node:sqlite";
import { agentInfoEqual } from "anyagent";
import {
  type CodexInfo,
  type CodexSession,
  deriveSessionState,
  getSessionContextTokens,
  getSessionTitle,
  openDb,
  subscribeCodexDb,
} from "./index.ts";
import type { Logger } from "anyagent";

// --- Tuning constants ---

/** Trailing-edge debounce for WAL fs.watch callbacks. Codex streams
 *  tokens during generation, and Linux fs.watch fires multiple events per
 *  write — without debouncing, `refresh` runs dozens of times per second
 *  during active use, each call running SQL queries. 150 ms coalesces
 *  bursts into one handler run while keeping user-perceptible lag
 *  imperceptible. Matches WAL_DEBOUNCE_MS in kolu-opencode. */
const WAL_DEBOUNCE_MS = 150;

// --- Watcher ---

export interface CodexWatcher {
  readonly session: CodexSession;
  destroy(): void;
}

/**
 * Start watching a Codex session. Reads the thread immediately
 * and emits an initial state, then re-reads on every WAL file change
 * (debounced) and emits a new state if it differs from the last one.
 *
 * `onChange` is called with the full CodexInfo each time state changes.
 * The caller is responsible for forwarding it to the metadata system.
 */
export function createCodexWatcher(
  session: CodexSession,
  onChange: (info: CodexInfo) => void,
  log?: Logger,
): CodexWatcher {
  let lastInfo: CodexInfo | null = null;
  let destroyed = false;
  // Trailing-edge debounce timer for WAL fs.watch events.
  // Null when idle. Cleared on destroy.
  let debounceTimer: NodeJS.Timeout | null = null;

  // Hoist the DB connection across the watcher's lifetime so we don't
  // open/close on every WAL event. Safe in WAL mode: an open connection
  // holds no locks until you start a transaction, and our queries are
  // autocommit.
  const db: DatabaseSync | null = openDb(log);

  function refresh() {
    if (destroyed || !db) return;
    const derived = deriveSessionState(session.id, log, db);
    if (!derived) {
      log?.debug({ session: session.id }, "no thread yet for codex session");
      return;
    }

    // Codex doesn't have explicit tool-use state in the DB, but we infer
    // it from approval_mode in parseThreadState
    const state = derived.state;

    // Codex doesn't have a todo/task system yet
    const taskProgress = null;

    // Re-read title on each refresh so mid-conversation title changes
    // are picked up live
    const summary = getSessionTitle(session.id, log, db) ?? session.title;

    const contextTokens = getSessionContextTokens(session.id, log, db);

    const info: CodexInfo = {
      kind: "codex",
      state,
      sessionId: session.id,
      model: derived.model,
      summary,
      taskProgress,
      contextTokens,
    };

    if (agentInfoEqual(lastInfo, info)) return;
    lastInfo = info;
    log?.debug(
      { state: info.state, model: info.model, session: info.sessionId },
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
    (err) =>
      log?.error({ err, session: session.id }, "codex wal listener threw"),
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
