import path from "node:path";
import { agentInfoEqual } from "anyagent";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import { deriveXyneInfo, type XyneSession } from "./core.ts";
import type { XyneInfo } from "./schemas.ts";

export const DEBOUNCE_MS = COALESCE_DEBOUNCE_MS;
export const DEBOUNCE_MAX_MS = COALESCE_MAX_WAIT_MS;

export interface XyneWatcher {
  readonly session: XyneSession;
  destroy(): void;
}

export function createXyneWatcher(
  session: XyneSession,
  onChange: (info: XyneInfo) => void,
  log?: Logger,
): XyneWatcher {
  let destroyed = false;
  let lastInfo: XyneInfo | null = null;
  const cleanups: Array<() => void> = [];

  function emitIfChanged(): void {
    if (destroyed) return;
    const info = deriveXyneInfo(session, log);
    if (!info) return;
    if (agentInfoEqual(info, lastInfo)) return;
    lastInfo = info;
    log?.debug(
      {
        model: info.model,
        session: info.sessionId,
      },
      "xyne state updated",
    );
    onChange(info);
  }

  const coalesce = createCoalesceSchedule({
    debounceMs: DEBOUNCE_MS,
    maxWaitMs: DEBOUNCE_MAX_MS,
    onFire: emitIfChanged,
  });
  cleanups.push(() => coalesce.destroy());

  function schedule(): void {
    if (destroyed) return;
    coalesce.schedule();
  }

  cleanups.push(
    subscribeFileAppends(session.transcriptPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "xyne: transcript",
    }),
  );

  cleanups.push(
    subscribeFileAppends(session.summaryPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "xyne: summary",
    }),
  );

  log?.info(
    { session: session.id, dir: path.dirname(session.transcriptPath) },
    "xyne: session watcher installed",
  );
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* ignore teardown races */
        }
      }
      cleanups.length = 0;
      log?.info({ session: session.id }, "xyne: session watcher retired");
    },
  };
}
