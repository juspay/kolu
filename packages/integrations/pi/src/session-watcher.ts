/**
 * PiWatcher — per-session lifecycle. Watches the session's JSONL transcript
 * with the shared append-robust subscription (`subscribeFileAppends`, which
 * tolerates absence, fires on the absent→present transition, and keys on
 * `size:mtime:ino` so a `/compact` rewrite also re-fires) plus the shared
 * coalesce schedule, and emits `PiInfo` on change, gated by `agentInfoEqual`.
 *
 * Pure observer: never creates paths under `~/.pi/agent`.
 *
 * Debounce rationale mirrors grok's (`session-watcher.ts` there): during an
 * active turn pi appends per tool call, so a pure trailing-edge debounce
 * would starve; `createCoalesceSchedule` with maxWait caps the freeze while
 * quiet turns still settle fast.
 */

import { agentInfoEqual } from "anyagent";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import { derivePiInfo, type PiSession } from "./core.ts";
import type { PiInfo } from "./schemas.ts";

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
  // The fold's three summary truths: a name, `null` (no session_info in the
  // 256 KB window — "unknown", merge the cache), or `""` (the newest
  // session_info carries no name — pi's explicit `/name`-clear; drop the
  // cache, do NOT resurrect a deleted title).
  let lastKnownSummary: string | null = null;

  function emitIfChanged(): void {
    if (destroyed) return;
    const derived = derivePiInfo(session, log);
    if (derived === null) return; // absent transcript / no turn entries yet
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
    };
    if (agentInfoEqual(info, lastInfo)) return;
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
  // Initial emit — lights the indicator immediately on match.
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
