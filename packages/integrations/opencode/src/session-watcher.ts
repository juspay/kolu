/**
 * OpenCodeWatcher — per-session lifecycle over the supplied executor.
 */

import { agentInfoEqual } from "anyagent";
import type { Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { createDebounceWatcher } from "kolu-shared/sqlite";
import {
  deriveSessionStateFromRunner,
  executorOpenCodeQueryRunner,
  getLatestAssistantContextTokensFromRunner,
  getSessionTaskProgressFromRunner,
  getSessionTitleFromRunner,
  type OpenCodeSession,
  runningToolsBucketFromRunner,
} from "./core.ts";
import type { OpenCodeInfo } from "./schemas.ts";
import { subscribeOpenCodeDb } from "./wal-watcher.ts";

const WAL_DEBOUNCE_MS = 150;

export interface OpenCodeWatcher {
  readonly session: OpenCodeSession;
  destroy(): void;
}

export function createOpenCodeWatcher(
  session: OpenCodeSession,
  executor: Executor,
  onChange: (info: OpenCodeInfo) => void,
  log?: Logger,
): OpenCodeWatcher {
  const runner = executorOpenCodeQueryRunner(session, executor, log);
  const watcherContext = { session, runner };

  async function readInfo(
    ctx: typeof watcherContext,
  ): Promise<OpenCodeInfo | null> {
    const derived = await deriveSessionStateFromRunner(
      ctx.session.id,
      ctx.runner,
    );
    if (!derived) {
      log?.debug(
        { session: ctx.session.id },
        "no messages yet for opencode session",
      );
      return null;
    }

    const state =
      derived.state === "thinking"
        ? ((await runningToolsBucketFromRunner(
            derived.messageId,
            ctx.runner,
          )) ?? derived.state)
        : derived.state;
    const taskProgress = await getSessionTaskProgressFromRunner(
      ctx.session.id,
      ctx.runner,
    );
    const summary =
      (await getSessionTitleFromRunner(ctx.session.id, ctx.runner)) ??
      ctx.session.title;
    const contextTokens = await getLatestAssistantContextTokensFromRunner(
      ctx.session.id,
      ctx.runner,
      log,
    );

    return {
      kind: "opencode",
      state,
      sessionId: ctx.session.id,
      model: derived.model,
      summary,
      taskProgress,
      contextTokens,
    };
  }

  return createDebounceWatcher({
    session,
    label: "opencode: session",
    debounceMs: WAL_DEBOUNCE_MS,
    db: watcherContext,
    subscribe: (onEvent, onError, plog) =>
      subscribeOpenCodeDb(
        executor,
        session.dbPath,
        session.walPath,
        onEvent,
        onError,
        plog,
      ),
    refresh: readInfo,
    isEqual: agentInfoEqual,
    onChange: (info) => {
      log?.debug(
        { state: info.state, model: info.model, session: info.sessionId },
        "opencode state updated",
      );
      onChange(info);
    },
    logCtx: { session: session.id },
    log,
  });
}
