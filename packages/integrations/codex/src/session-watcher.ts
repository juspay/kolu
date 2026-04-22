import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { agentInfoEqual } from "anyagent";
import {
  type CodexInfo,
  type CodexSession,
  deriveSessionState,
  getSessionTitle,
  getThreadModel,
  getThreadTokens,
  openDb,
  subscribeCodexDb,
} from "./index.ts";
import type { Logger } from "anyagent";

const ROLLOUT_DEBOUNCE_MS = 150;

export interface CodexWatcher {
  readonly session: CodexSession;
  destroy(): void;
}

export function createCodexWatcher(
  session: CodexSession,
  onChange: (info: CodexInfo) => void,
  log?: Logger,
): CodexWatcher {
  let lastInfo: CodexInfo | null = null;
  let destroyed = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const db: DatabaseSync | null = openDb(log);

  let rolloutWatcher: fs.FSWatcher | null = null;

  function refresh() {
    if (destroyed) return;

    const derived = deriveSessionState(session.rolloutPath, log);

    const state = derived?.state ?? "waiting";
    const contextTokens =
      derived?.contextTokens ??
      getThreadTokens(session.id, log, db ?? undefined);

    const summary =
      getSessionTitle(session.id, log, db ?? undefined) ?? session.title;
    const model = getThreadModel(session.id, log, db ?? undefined);

    const info: CodexInfo = {
      kind: "codex",
      state,
      sessionId: session.id,
      model,
      summary,
      taskProgress: null,
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

  function scheduleRefresh() {
    if (destroyed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      refresh();
    }, ROLLOUT_DEBOUNCE_MS);
  }

  const unsubscribeDb = subscribeCodexDb(
    scheduleRefresh,
    (err) =>
      log?.error({ err, session: session.id }, "codex db listener threw"),
    log,
  );

  try {
    rolloutWatcher = fs.watch(session.rolloutPath, () => scheduleRefresh());
  } catch (err) {
    log?.debug(
      { err, path: session.rolloutPath },
      "codex rollout fs.watch failed, falling back to db-only watching",
    );
  }

  refresh();

  return {
    session,
    destroy() {
      destroyed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      rolloutWatcher?.close();
      rolloutWatcher = null;
      unsubscribeDb();
      db?.close();
    },
  };
}
