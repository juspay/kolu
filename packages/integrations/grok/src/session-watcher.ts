/**
 * ## Debounce + maxWait (juspay/kolu#1952)
 *
 * Grok's `events.jsonl` is *not* a sparse transcript: a single turn can append
 * hundreds of `phase_changed` lines per second (`streaming_text` /
 * `streaming_reasoning`). A pure trailing-edge debounce never reaches its
 * quiet window while that burst is live — so re-derive freezes on the
 * pre-burst state, and the 1s append-poll floor (#1754) is defeated too
 * (it feeds the same schedule). Coalescing uses `kolu-io`'s shared
 * `createCoalesceSchedule` with `COALESCE_MAX_WAIT_MS` so hot turns publish
 * at least every half-second; quiet turns still settle in 150ms.
 */

import fs from "node:fs";
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
import { deriveGrokInfo, type GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";

export interface GrokWatcher {
  readonly session: GrokSession;
  destroy(): void;
}

export function createGrokWatcher(
  session: GrokSession,
  onChange: (info: GrokInfo) => void,
  log?: Logger,
): GrokWatcher {
  let destroyed = false;
  let lastInfo: GrokInfo | null = null;
  const cleanups: Array<() => void> = [];

  function emitIfChanged(): void {
    if (destroyed) return;
    const info = deriveGrokInfo(session, log);
    if (agentInfoEqual(info, lastInfo)) return;
    lastInfo = info;
    log?.debug(
      {
        state: info.state,
        model: info.model,
        session: info.sessionId,
      },
      "grok state updated",
    );
    onChange(info);
  }

  const coalesce = createCoalesceSchedule({
    debounceMs: COALESCE_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: emitIfChanged,
  });
  cleanups.push(() => coalesce.destroy());

  function schedule(): void {
    if (destroyed) return;
    coalesce.schedule();
  }

  function watchEdgeOnly(p: string): void {
    try {
      const w = fs.watch(p, () => schedule());
      cleanups.push(() => w.close());
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, path: p }, "grok: failed to watch session file");
        return;
      }
    }
    rearmWhenFileAppears(p);
  }

  function rearmWhenFileAppears(p: string): void {
    const dir = path.dirname(p);
    const base = path.basename(p);
    try {
      const w = fs.watch(dir, (_evt, filename) => {
        if (
          filename === base ||
          filename === `${base}.tmp` ||
          filename === null
        ) {
          schedule();
        }
      });
      cleanups.push(() => w.close());
    } catch (err2) {
      log?.debug(
        { err: err2, path: p },
        "grok: session path not watchable yet",
      );
    }
  }

  // macOS kqueue never fires a dir-watch for a child's content appends, so the
  // append-poll floor is the only steady-state signal events.jsonl can have —
  // subscribed unconditionally, it tolerates absence and fires on appearance
  // (juspay/kolu#1754).
  cleanups.push(
    subscribeFileAppends(session.eventsPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "grok: events",
    }),
  );
  watchEdgeOnly(session.summaryPath);
  watchEdgeOnly(session.signalsPath);
  log?.info(
    { session: session.id, dir: path.dirname(session.eventsPath) },
    "grok: session watcher installed",
  );
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      for (const c of cleanups) {
        try {
          c();
        } catch (err) {
          log?.error(
            { err, session: session.id },
            "grok: session watcher cleanup failed",
          );
        }
      }
      cleanups.length = 0;
      log?.info({ session: session.id }, "grok: session watcher retired");
    },
  };
}
