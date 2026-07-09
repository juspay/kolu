/**
 * GrokWatcher — per-session lifecycle. Watches `events.jsonl` +
 * `summary.json` with a trailing-edge debounce and emits GrokInfo on
 * change, gated by `agentInfoEqual`.
 */

import fs from "node:fs";
import path from "node:path";
import { agentInfoEqual } from "anyagent";
import type { Logger } from "kolu-shared";
import { deriveGrokInfo, type GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";

const DEBOUNCE_MS = 150;

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
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers: fs.FSWatcher[] = [];

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

  function schedule(): void {
    if (destroyed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      emitIfChanged();
    }, DEBOUNCE_MS);
  }

  function watchPath(p: string): void {
    try {
      // Ensure parent exists so fs.watch doesn't throw ENOENT on a
      // brand-new session that hasn't flushed events yet.
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      const w = fs.watch(p, () => schedule());
      watchers.push(w);
    } catch (err) {
      // File may not exist yet — watch the parent directory instead.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          const dir = path.dirname(p);
          fs.mkdirSync(dir, { recursive: true });
          const w = fs.watch(dir, (_evt, filename) => {
            if (
              filename === path.basename(p) ||
              filename === `${path.basename(p)}.tmp`
            ) {
              schedule();
            }
          });
          watchers.push(w);
        } catch (err2) {
          log?.error(
            { err: err2, path: p },
            "grok: failed to watch session dir",
          );
        }
        return;
      }
      log?.error({ err, path: p }, "grok: failed to watch session file");
    }
  }

  watchPath(session.eventsPath);
  watchPath(session.summaryPath);
  // Initial emit — lights the indicator immediately on match.
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
      watchers.length = 0;
    },
  };
}
