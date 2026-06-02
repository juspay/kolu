/**
 * OpenCodeWatcher — encapsulates all per-session lifecycle state.
 *
 * Wraps `kolu-shared`'s generic `createDebounceWatcher` with opencode's
 * SQLite refresh logic. The factory owns the destroy flag, debounce
 * timer, DB lifetime, equality-gated dispatch, and lifecycle logs;
 * this file only owns the per-event `refresh` body.
 *
 * The server's opencode provider creates one of these per matched
 * session and replaces it on session change.
 */

import type { DatabaseSync } from "node:sqlite";
import { agentInfoEqual } from "anyagent";
import type { Logger } from "kolu-shared";
import { createDebounceWatcher } from "kolu-shared/sqlite";
import {
  deriveSessionState,
  getLatestAssistantContextTokens,
  getSessionTaskProgress,
  getSessionTitle,
  type OpenCodeSession,
  openDb,
  runningToolsBucket,
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
  function refresh(db: DatabaseSync): OpenCodeInfo | null {
    const derived = deriveSessionState(session.id, log, db);
    if (!derived) {
      // deriveSessionState already logged the precise cause — a debug
      // "no messages yet" for an empty session, or an error for a malformed
      // latest row. Don't flatten both back into one ambiguous line here.
      return null;
    }

    // When the assistant is actively generating (state === "thinking"),
    // classify the current message's running tool parts to distinguish
    // tool execution from LLM generation — and within tool execution,
    // separate "blocked on user question" from real compute. Scoped to
    // derived.messageId (the latest message) — not the entire session —
    // so we only scan the handful of current-turn parts.
    const state =
      derived.state === "thinking"
        ? (runningToolsBucket(derived.messageId, log, db) ?? derived.state)
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

    return {
      kind: "opencode",
      state,
      sessionId: session.id,
      model: derived.model,
      summary,
      taskProgress,
      contextTokens,
    };
  }

  function logAndDispatch(info: OpenCodeInfo): void {
    log?.debug(
      { state: info.state, model: info.model, session: info.sessionId },
      "opencode state updated",
    );
    onChange(info);
  }

  // Hoist the DB connection across the watcher's lifetime so we don't
  // open/close on every WAL event. Safe in WAL mode: an open connection
  // holds no locks until you start a transaction, and our queries are
  // autocommit. See README's OpenCode Status section for the full
  // locking analysis.
  const db = openDb(log);

  return createDebounceWatcher({
    session,
    label: "opencode: session",
    debounceMs: WAL_DEBOUNCE_MS,
    db,
    subscribe: subscribeOpenCodeDb,
    refresh,
    isEqual: agentInfoEqual,
    onChange: logAndDispatch,
    logCtx: { session: session.id },
    log,
  });
}
