/**
 * GrokWatcher — per-session lifecycle. Watches `events.jsonl` +
 * `summary.json` with a trailing-edge debounce and emits GrokInfo on
 * change, gated by `agentInfoEqual`.
 *
 * Pure observer: never creates paths under `~/.grok`. If a file is
 * missing, watches its parent directory (when that exists) and re-arms
 * when the basename appears — same observe-without-mutate idea as
 * Claude's session watchers.
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
    // Watch the parent (session) dir, never the file inode: Grok rewrites
    // summary.json via temp+rename, which destroys an `fs.watch` pointed at
    // the file itself (the same volatility active-sessions-watcher documents).
    // A dir watch survives the rename AND re-arms when a not-yet-flushed file
    // first appears, so one code path covers both. Never mkdir.
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
      watchers.push(w);
    } catch (err) {
      // ENOENT = session dir not created yet (derive handles absent files as
      // thinking; the active_sessions re-resolve recreates the watcher once
      // the dir exists). Anything else is a real fault — surface it.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, path: dir }, "grok: failed to watch session dir");
      } else {
        log?.debug({ path: p }, "grok: session dir not present yet");
      }
    }
  }

  watchPath(session.eventsPath);
  watchPath(session.summaryPath);
  // Standard grep-able watcher-lifecycle line (matches active-sessions-watcher
  // and the claude-code session watcher) so operator watcher-count correlation
  // sees this per-session watcher come up.
  log?.info(
    { session: session.id, dir: path.dirname(session.eventsPath) },
    "grok: session watcher installed",
  );
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
          /* ignore close races */
        }
      }
      watchers.length = 0;
      log?.info({ session: session.id }, "grok: session watcher retired");
    },
  };
}
