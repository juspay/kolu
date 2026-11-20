import { Schema } from "effect";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import { derivePiInfo, type PiSession } from "./core.ts";
import { type PiInfo, PiInfoSchema } from "./schemas.ts";

const samePiInfo = Schema.toEquivalence(PiInfoSchema);

export interface PiWatcher {
  readonly session: PiSession;
  destroy(): void;
}

export function createPiWatcher(
  session: PiSession,
  onChange: (info: PiInfo) => void,
  log?: Logger,
): PiWatcher {
  let destroyed = false;
  let lastInfo: PiInfo | null = null;
  let lastKnownSummary: string | null = null;

  function emitIfChanged(): void {
    if (destroyed) return;
    const derived = derivePiInfo(session, log);
    if (derived === null) return;
    let summary: string | null;
    if (derived.summary === "") {
      lastKnownSummary = null;
      summary = null;
    } else if (derived.summary === null) {
      summary = lastKnownSummary;
    } else {
      lastKnownSummary = derived.summary;
      summary = derived.summary;
    }
    const info: PiInfo = {
      kind: "pi",
      state: derived.state,
      sessionId: session.id,
      sessionPath: session.transcriptPath,
      model: derived.model,
      summary,
      taskProgress: null,
      contextTokens: derived.contextTokens,
      startedAt: session.startedAt,
      lastPromptId: derived.lastPromptId,
      lastPromptText: derived.lastPromptText,
    };
    if (lastInfo !== null && samePiInfo(info, lastInfo)) return;
    lastInfo = info;
    log?.debug(
      {
        state: info.state,
        model: info.model,
        session: info.sessionId,
        tokens: info.contextTokens,
      },
      "pi state updated",
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
      label: "pi: transcript",
    },
  );

  log?.info(
    { session: session.id, path: session.transcriptPath },
    "pi: session watcher installed",
  );
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      unsubscribe();
      coalesce.destroy();
      log?.info({ session: session.id }, "pi: session watcher retired");
    },
  };
}
