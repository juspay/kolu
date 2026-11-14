/** OmpWatcher — per-session lifecycle. Watches the session's JSONL transcript
 *  with the shared append-robust subscription (`subscribeFileAppends`, which
 *  tolerates absence, fires on the absent→present transition, and keys on
 *  `size:mtime:ino` so a rewrite also re-fires) plus the shared coalesce
 *  schedule, and emits `OmpInfo` on change, gated by `agentInfoEqual`. The
 *  todo list's progress rides the same tick: `createTodoProgressReader` reads
 *  only the bytes appended since the last tick (see `todo.ts`).
 *
 *  Pure observer: never creates paths under the agent dir. A session whose
 *  JSONL has not materialized yet (omp's `fresh` crumb) emits nothing until the
 *  file lands — the absent→present floor is what lights the session-backed
 *  state then, with no nudge. Until it does, padi shows the agent from its
 *  foreground alone (`starting` → `fresh`), carrying the session id this
 *  adapter names through `presenceSessionId`.
 *
 *  Debounce rationale mirrors pi's: during an active turn omp appends per tool
 *  call, so a pure trailing-edge debounce would starve; `createCoalesceSchedule`
 *  with maxWait caps the freeze while quiet turns still settle fast. */

import { agentInfoEqual } from "anyagent";
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
import type { OmpInfo } from "./schemas.ts";
import { createTodoProgressReader } from "./todo.ts";

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
    if (derived === null) return; // absent transcript / no turn entries yet
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
    };
    if (agentInfoEqual(info, lastInfo)) return;
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
  // Initial emit — lights the indicator immediately on match.
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
