/**
 * XyneWatcher — per-session lifecycle. Watches the matched session's
 * transcript + summary sidecar with a trailing-edge debounce and emits
 * XyneInfo on change, gated by `agentInfoEqual`.
 *
 * Pure observer: never creates paths under `~/.xyne`. A summary sidecar
 * that lands after the first summarized turn is re-armed via the parent
 * session-directory watch (same observe-without-mutate idea as Claude's
 * session watchers).
 */

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

/** Quiet-window — re-export of the shared constant so tests pin the same
 *  number the real watcher uses. */
export const DEBOUNCE_MS = COALESCE_DEBOUNCE_MS;
/** Hard maxWait — re-export of the shared constant for the starvation pin. */
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
    // The transcript vanished (session deleted / replaced) — hold the last
    // emitted info rather than lie about a session we can no longer read.
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

  // The transcript JSONL is the primary signal: Xyne appends during turns
  // (user messages land live) and on turn completion. Wrap it in the
  // append-robust floor (juspay/kolu#1754): a dropped/coalesced append edge —
  // macOS kqueue especially — would otherwise strand the tile on the
  // pre-turn title forever. The floor tolerates absence and fires on
  // appearance, covering a transcript flushed after the match.
  cleanups.push(
    subscribeFileAppends(session.transcriptPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "xyne: transcript",
    }),
  );

  // The summary sidecar carries the display title and lands AFTER the first
  // summarized turn. Unlike grok (whose high-frequency events.jsonl re-reads
  // summary.json on every turn boundary, so an edge-only watch suffices),
  // xyne's transcript is its ONLY re-read trigger and is sparse — an
  // edge-only watch on the sidecar would stale the title until the next
  // user message. The sidecar gets its own append-robust floor for the
  // same reason the transcript does: a summary rewrite whose edge the watch
  // drops must not strand the badge.
  // exist at match time. Same append-robust receptacle as the transcript:
  // tolerates absence, fires on appearance, and its 1s floor also covers a
  // summary rewrite whose edge the watch drops (title freshness is the only
  // thing this subscription drives — the state and identity ride the
  // transcript above).
  cleanups.push(
    subscribeFileAppends(session.summaryPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "xyne: summary",
    }),
  );

  // Standard grep-able watcher-lifecycle line so operator watcher-count
  // correlation sees this per-session watcher come up.
  log?.info(
    { session: session.id, dir: path.dirname(session.transcriptPath) },
    "xyne: session watcher installed",
  );
  // Initial emit — lights the indicator immediately on match.
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
