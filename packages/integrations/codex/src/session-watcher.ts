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

const WAL_DEBOUNCE_MS = 150;

const TAIL_BYTES = 256 * 1024;

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
  let cachedDerive: {
    size: number;
    state: CodexInfo["state"];
    contextTokens: number | null;
  } | null = null;

  function refresh(db: DatabaseSync): CodexInfo | null {
    const meta = getThreadMetadata(session.id, log, db);
    if (!meta) {
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
