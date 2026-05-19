/**
 * CodexWatcher — encapsulates per-session lifecycle state.
 *
 * Lifecycle (no polling — fully push-driven):
 *  1. Install `executor.watch` on the rollout JSONL's parent directory
 *     (any write to the JSONL or to a sibling state-DB WAL fires there).
 *  2. Debounce the change bursts (Codex appends multiple lines per turn).
 *  3. On each debounced tick: stat the rollout via `executor.statMtimeMs`;
 *     if mtime is unchanged from the cached value, skip the heavy tail
 *     read (this catches the "WAL touched but rollout didn't" case).
 *  4. Otherwise: tail the rollout via the executor, derive state, and
 *     emit `CodexInfo` if it differs from the last one.
 */

import { type AgentWatcher, agentInfoEqual, type Executor } from "anyagent";
import type { Logger } from "kolu-shared";
import {
  type CodexSession,
  getThreadMetadata,
  parseRolloutContextTokens,
  parseRolloutState,
  readRolloutTail,
} from "./core.ts";
import type { CodexInfo } from "./schemas.ts";

const WAL_DEBOUNCE_MS = 150;

/** Tail window for reading the rollout JSONL. Sized to comfortably
 *  contain the last few turns. */
const TAIL_BYTES = 256 * 1024;

export interface CodexWatcher extends AgentWatcher {
  readonly session: CodexSession;
}

export function createCodexWatcher(
  session: CodexSession,
  executor: Executor,
  onChange: (info: CodexInfo) => void,
  log?: Logger,
): CodexWatcher {
  let last: CodexInfo | null = null;
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let walHandle: { stop(): void } | null = null;
  let rolloutHandle: { stop(): void } | null = null;
  let pending = false;
  let inFlight = false;
  let cachedMtime: number | null = null;
  let cachedDerive: {
    state: CodexInfo["state"];
    contextTokens: number | null;
  } | null = null;

  async function refresh(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const meta = await getThreadMetadata(
        session.id,
        session.dbPath,
        executor,
        log,
      );
      if (stopped) return;
      if (!meta) {
        log?.warn(
          { session: session.id },
          "codex thread row disappeared after match",
        );
        return;
      }

      let state: CodexInfo["state"];
      let contextTokens: number | null;
      let mtime: number | null = null;
      try {
        mtime = await executor.statMtimeMs(session.rolloutPath);
      } catch (err) {
        log?.debug(
          { err, path: session.rolloutPath },
          "codex rollout stat failed",
        );
      }
      if (stopped) return;
      if (mtime !== null && cachedMtime === mtime && cachedDerive) {
        state = cachedDerive.state;
        contextTokens = cachedDerive.contextTokens;
      } else {
        const lines = await readRolloutTail(
          session.rolloutPath,
          TAIL_BYTES,
          executor,
          log,
        );
        if (stopped) return;
        if (lines === null) return;
        const parsedState = parseRolloutState(lines);
        if (parsedState === null) {
          log?.debug(
            { session: session.id },
            "codex rollout has no task events yet",
          );
          return;
        }
        state = parsedState;
        contextTokens = parseRolloutContextTokens(lines);
        if (mtime !== null) {
          cachedMtime = mtime;
          cachedDerive = { state, contextTokens };
        }
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
      if (agentInfoEqual(info, last)) return;
      last = info;
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
    } catch (err) {
      log?.debug({ err, session: session.id }, "codex refresh failed");
    } finally {
      inFlight = false;
      if (pending && !stopped) {
        pending = false;
        setTimeout(() => void refresh(), 0);
      }
    }
  }

  function scheduleRefresh(): void {
    if (stopped) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void refresh();
    }, WAL_DEBOUNCE_MS);
  }

  void (async () => {
    // Watch the SQLite WAL (catches title / model row touches) AND the
    // rollout JSONL (catches state-changing turn events). Either signal
    // schedules a refresh; the mtime-cache short-circuits the tail read
    // for SQLite-only events.
    try {
      walHandle = await executor.watch(
        `${session.dbPath}-wal`,
        () => scheduleRefresh(),
        { recursive: false },
      );
    } catch (err) {
      log?.debug(
        { err, walPath: `${session.dbPath}-wal` },
        "codex WAL watch install failed",
      );
    }
    try {
      rolloutHandle = await executor.watch(
        session.rolloutPath,
        () => scheduleRefresh(),
        { recursive: false },
      );
    } catch (err) {
      log?.debug(
        { err, path: session.rolloutPath },
        "codex rollout watch install failed",
      );
    }
    void refresh();
  })();

  return {
    session,
    destroy: () => {
      stopped = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      walHandle?.stop();
      rolloutHandle?.stop();
      walHandle = null;
      rolloutHandle = null;
    },
  };
}
