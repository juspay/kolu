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
import type { Logger } from "anyagent";
import { agentInfoEqual } from "anyagent";
import {
  deriveSessionState,
  getLatestAssistantContextTokens,
  getSessionTaskProgress,
  getSessionTitle,
  hasRunningTools,
  type OpenCodeSession,
  openDb,
} from "./core.ts";
import type { OpenCodeInfo } from "./schemas.ts";
import { subscribeOpenCodeDb } from "./wal-watcher.ts";

// --- Tuning constants ---

/** Trailing-edge debounce for WAL fs.watch callbacks. OpenCode streams
 *  parts during generation, and Linux fs.watch fires multiple events per
 *  write — without debouncing, `refresh` runs dozens of times per second
 *  during active use, each call running two SQL queries. 150 ms coalesces
 *  bursts into one handler run while keeping user-perceptible lag
 *  imperceptible. Matches TRANSCRIPT_DEBOUNCE_MS in kolu-claude-code. */
const WAL_DEBOUNCE_MS = 150;

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

    // When the assistant is actively generating (state === "thinking"),
    // check whether the current message has any tool parts in the
    // "running" state to distinguish tool execution from LLM generation.
    // Scoped to derived.messageId (the latest message) — not the entire
    // session — so we only scan the handful of current-turn parts.
    const state =
      derived.state === "thinking" &&
      hasRunningTools(derived.messageId, log, db)
        ? ("tool_use" as const)
        : derived.state;

    const taskProgress = getSessionTaskProgress(session.id, log, db);
    // Re-read title on each refresh so mid-conversation title changes
    // (e.g. OpenCode auto-generating a title after the first exchange)
    // are picked up live, not stuck at the snapshot from session match.
    const summary = getSessionTitle(session.id, log, db) ?? session.title;
    // Context-token total comes from its own query — the latest assistant
    // message's tokens.total, which survives a newer user prompt (Thinking
    // state). Using derived.state's single-message lens would blank the
    // count whenever the user is typing.
    const contextTokens = getLatestAssistantContextTokens(session.id, log, db);

    const info: OpenCodeInfo = {
      kind: "opencode",
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
