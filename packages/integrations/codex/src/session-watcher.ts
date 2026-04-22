import fs from "node:fs";
import path from "node:path";
import { agentInfoEqual } from "anyagent";
import {
  type CodexInfo,
  type CodexSession,
  type CodexThreadSnapshot,
  getThreadSnapshot,
  readRolloutState,
} from "./index.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";
import type { Logger } from "anyagent";

const WAL_DEBOUNCE_MS = 150;

type RolloutWatching =
  | { kind: "none" }
  | { kind: "waiting"; cleanup: () => void }
  | { kind: "watching"; path: string; watcher: fs.FSWatcher };

export interface CodexWatcher {
  readonly session: CodexSession;
  destroy(): void;
}

export function createCodexWatcher(
  session: CodexSession,
  onChange: (info: CodexInfo) => void,
  log?: Logger,
): CodexWatcher {
  let destroyed = false;
  let lastInfo: CodexInfo | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let rolloutWatching: RolloutWatching = { kind: "none" };

  function teardownRolloutWatching() {
    if (rolloutWatching.kind === "watching") rolloutWatching.watcher.close();
    if (rolloutWatching.kind === "waiting") rolloutWatching.cleanup();
    rolloutWatching = { kind: "none" };
  }

  function scheduleRefresh() {
    if (destroyed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      refresh();
    }, WAL_DEBOUNCE_MS);
  }

  function syncRolloutWatcher(rolloutPath: string) {
    if (
      rolloutWatching.kind === "watching" &&
      rolloutWatching.path === rolloutPath
    ) {
      return;
    }

    teardownRolloutWatching();

    try {
      const watcher = fs.watch(rolloutPath, () => scheduleRefresh());
      rolloutWatching = { kind: "watching", path: rolloutPath, watcher };
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.debug({ err, path: rolloutPath }, "codex rollout fs.watch failed");
      }
    }

    const dir = path.dirname(rolloutPath);
    try {
      const dirWatcher = fs.watch(dir, () => {
        if (!fs.existsSync(rolloutPath)) return;
        dirWatcher.close();
        rolloutWatching = { kind: "none" };
        syncRolloutWatcher(rolloutPath);
        scheduleRefresh();
      });
      rolloutWatching = {
        kind: "waiting",
        cleanup: () => dirWatcher.close(),
      };
    } catch (err) {
      log?.debug({ err, dir }, "codex rollout dir fs.watch failed");
    }
  }

  function emit(snapshot: CodexThreadSnapshot, state: CodexInfo["state"]) {
    const info: CodexInfo = {
      kind: "codex",
      state,
      sessionId: session.id,
      model: snapshot.model ?? session.model,
      summary: snapshot.title,
      taskProgress: null,
      contextTokens: null,
    };
    if (agentInfoEqual(lastInfo, info)) return;
    lastInfo = info;
    log?.debug(
      { state: info.state, model: info.model, session: info.sessionId },
      "codex state updated",
    );
    onChange(info);
  }

  function refresh() {
    if (destroyed) return;
    const snapshot =
      getThreadSnapshot(session.id, session.stateDbPath, log) ?? session;

    syncRolloutWatcher(snapshot.rolloutPath);
    const state = readRolloutState(snapshot.rolloutPath);
    if (!state) {
      log?.debug(
        { path: snapshot.rolloutPath, session: session.id },
        "codex rollout had no actionable state",
      );
      return;
    }

    emit(snapshot, state);
  }

  const unsubscribe = subscribeCodexDb(
    session.stateDbPath,
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
      teardownRolloutWatching();
      unsubscribe();
    },
  };
}
