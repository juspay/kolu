import { Schema } from "effect";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import type { OmpSession } from "./breadcrumb.ts";
import { deriveOmpInfo } from "./core.ts";
import { type OmpInfo, OmpInfoSchema } from "./schemas.ts";
import { createTodoProgressReader } from "./todo.ts";

const sameOmpInfo = Schema.toEquivalence(OmpInfoSchema);

export interface OmpWatcher {
  readonly session: OmpSession;
  destroy(): void;
}

export function createOmpWatcher(
  session: OmpSession,
  onChange: (info: OmpInfo) => void,
  log?: Logger,
): OmpWatcher {
  let destroyed = false;
  let lastInfo: OmpInfo | null = null;
  const todo = createTodoProgressReader(session.transcriptPath, log);

  function emitIfChanged(): void {
    if (destroyed) return;
    const derived = deriveOmpInfo(session, log);
    if (derived === null) return;
    const info: OmpInfo = {
      kind: "omp",
      state: derived.state,
      sessionId: session.id,
      sessionPath: session.transcriptPath,
      model: derived.model,
      summary: derived.summary,
      taskProgress: todo.read(),
      contextTokens: derived.contextTokens,
      startedAt: session.startedAt,
      lastPromptId: derived.lastPromptId,
      lastPromptText: derived.lastPromptText,
    };
    if (lastInfo !== null && sameOmpInfo(info, lastInfo)) return;
    lastInfo = info;
    log?.debug(
      {
        state: info.state,
        model: info.model,
        session: info.sessionId,
        tokens: info.contextTokens,
        tasks: info.taskProgress,
      },
      "omp state updated",
    );
    onChange(info);
  }

  const coalesce = createCoalesceSchedule({
    debounceMs: COALESCE_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: emitIfChanged,
  });

  const unsubscribe = subscribeFileAppends(
    session.transcriptPath,
    () => {
      if (destroyed) return;
      coalesce.schedule();
    },
    {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "omp: transcript",
    },
  );

  log?.info(
    { session: session.id, path: session.transcriptPath },
    "omp: session watcher installed",
  );
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      unsubscribe();
      coalesce.destroy();
      log?.info({ session: session.id }, "omp: session watcher retired");
    },
  };
}
