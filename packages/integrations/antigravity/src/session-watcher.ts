/**
 * AntigravityWatcher — per-conversation lifecycle. Watches the transcript and
 * the title file with kolu-io's append-robust subscription (tolerates absence,
 * fires when the file appears, a poll floor under the edge) plus the shared
 * coalesce schedule, and emits `AntigravityInfo` when any field changes.
 *
 * Pure observer: never creates a path under `agy`'s app data directory.
 */

import { Schema } from "effect";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import {
  type AntigravitySession,
  readAntigravityFold,
  readStartedAt,
} from "./core.ts";
import { type AntigravityInfo, AntigravityInfoSchema } from "./schemas.ts";
import { readTitle } from "./title.ts";

/** Equality over every field of `AntigravityInfo`, derived from its schema. */
const sameInfo = Schema.toEquivalence(AntigravityInfoSchema);

export interface AntigravityWatcher {
  readonly session: AntigravitySession;
  destroy(): void;
}

export function createAntigravityWatcher(
  session: AntigravitySession,
  onChange: (info: AntigravityInfo) => void,
  log?: Logger,
): AntigravityWatcher {
  let destroyed = false;
  let lastInfo: AntigravityInfo | null = null;

  function emitIfChanged(): void {
    if (destroyed) return;
    const fold = readAntigravityFold(session, log);
    // No transcript yet (a conversation `/clear` opened, before its first
    // prompt), or a line this fold does not know: publish nothing.
    if (fold === null) return;
    const info: AntigravityInfo = {
      kind: "antigravity",
      state: fold.state,
      sessionId: session.id,
      model: fold.model,
      summary: readTitle(session, log),
      taskProgress: null,
      contextTokens: fold.contextTokens,
      startedAt: readStartedAt(session, log),
    };
    if (lastInfo !== null && sameInfo(info, lastInfo)) return;
    lastInfo = info;
    log?.debug(
      {
        state: info.state,
        model: info.model,
        session: info.sessionId,
        tokens: info.contextTokens,
      },
      "antigravity state updated",
    );
    onChange(info);
  }

  const coalesce = createCoalesceSchedule({
    debounceMs: COALESCE_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: emitIfChanged,
  });
  const schedule = (): void => {
    if (!destroyed) coalesce.schedule();
  };

  const unsubscribes = [
    subscribeFileAppends(session.transcriptPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "antigravity: transcript",
    }),
    // The title lands about half a second after the first prompt and is
    // replaced by `/rename`, which writes nothing to the transcript.
    subscribeFileAppends(session.annotationsPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "antigravity: title",
    }),
  ];

  log?.info(
    { session: session.id, path: session.transcriptPath },
    "antigravity: session watcher installed",
  );
  // Initial emit — lights the indicator immediately on match.
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      coalesce.destroy();
      log?.info(
        { session: session.id },
        "antigravity: session watcher retired",
      );
    },
  };
}
