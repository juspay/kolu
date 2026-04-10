/**
 * OpenCodeWatcher — encapsulates all per-session lifecycle state.
 *
 * Creating an OpenCodeWatcher starts watching the SQLite WAL file for the
 * matched session and emits state via the onChange callback. Destroying it
 * tears down the file watcher. No "remember to reset N variables"
 * invariant — the lifetime IS the object.
 *
 * The server's opencode provider creates one of these per matched session
 * and replaces it on session change. Mirrors the SessionWatcher pattern
 * from `kolu-claude-code` (PR #437).
 */

import {
  type OpenCodeInfo,
  type OpenCodeSession,
  deriveSessionState,
  watchOpenCodeDb,
} from "./index.ts";

// --- Logger interface (shared across the package) ---

type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

// --- Equality ---

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
    a.summary === b.summary
  );
}

// --- Watcher ---

export interface OpenCodeWatcher {
  readonly session: OpenCodeSession;
  destroy(): void;
}

/**
 * Start watching an OpenCode session. Reads the latest message immediately
 * and emits an initial state, then re-reads on every WAL file change and
 * emits a new state if it differs from the last one.
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

  function refresh() {
    const derived = deriveSessionState(session.id, log);
    if (!derived) {
      log?.debug(
        { session: session.id },
        "no messages yet for opencode session",
      );
      return;
    }

    const info: OpenCodeInfo = {
      kind: "opencode",
      state: derived.state,
      sessionId: session.id,
      model: derived.model,
      summary: session.title,
    };

    if (infoEqual(lastInfo, info)) return;
    lastInfo = info;
    log?.info(
      { state: info.state, model: info.model, session: info.sessionId },
      "opencode state updated",
    );
    onChange(info);
  }

  const stopWatching = watchOpenCodeDb(refresh, log);
  refresh();

  return {
    session,
    destroy() {
      stopWatching();
    },
  };
}
