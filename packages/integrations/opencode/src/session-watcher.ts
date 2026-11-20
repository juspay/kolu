import type { DatabaseSync } from "node:sqlite";
import { agentInfoEqual } from "anyagent";
import type { Logger } from "kolu-shared";
import { createDebounceWatcher } from "kolu-shared/sqlite";
import {
  deriveSessionState,
  getLatestAssistantFacts,
  getSessionStartedAt,
  getSessionTitle,
  type OpenCodeSession,
  openDb,
} from "./core.ts";
import type { OpenCodeInfo } from "./schemas.ts";
import { subscribeOpenCodeDb } from "./wal-watcher.ts";

/** Trailing-edge debounce for WAL fs.watch callbacks. OpenCode streams
 *  parts during generation, and Linux fs.watch fires multiple events per
 *  write. Matches TRANSCRIPT_DEBOUNCE_MS in kolu-claude-code. */
const WAL_DEBOUNCE_MS = 150;

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
  let startedAt: number | null = null;

  function refresh(db: DatabaseSync): OpenCodeInfo | null {
    const derived = deriveSessionState(session.id, log, db);
    if (!derived) {
      return null;
    }

    const summary = getSessionTitle(session.id, log, db) ?? session.title;
    const assistant = getLatestAssistantFacts(session.id, log, db);
    startedAt ??= getSessionStartedAt(session.id, log, db);

    return {
      kind: "opencode",
      state: derived.state,
      sessionId: session.id,
      model: assistant?.model ?? null,
      summary,
      // OpenCode 2.x keeps no todo table — see `OpenCodeInfoSchema`.
      taskProgress: null,
      contextTokens: assistant?.contextTokens ?? null,
      startedAt,
    };
  }

  function logAndDispatch(info: OpenCodeInfo): void {
    log?.debug(
      { state: info.state, model: info.model, session: info.sessionId },
      "opencode state updated",
    );
    onChange(info);
  }

  // Safe in WAL mode: an open connection holds no locks until a transaction
  // starts, and our queries are autocommit.
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
