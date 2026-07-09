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
    // Watch the FILE inode directly — do NOT watch the parent dir instead.
    // events.jsonl is append-only and is the primary state signal; a file
    // watch catches its in-place writes on both platforms, but a *directory*
    // watch does NOT on macOS: Node's fs.watch uses kqueue there, and a dir
    // watch only fires on entry add/remove/rename, never on content appends to
    // a file inside it (inotify on Linux does report those, which is why a
    // dir-watch bug here passes linux CI yet freezes the tile on macOS). The
    // trade-off — a direct watch on summary.json dies after Grok's temp+rename
    // rewrite — is benign: deriveGrokInfo re-reads summary.json fresh on every
    // events.jsonl tick, so model/title stay current without a live summary
    // watch. Never mkdir.
    try {
      const w = fs.watch(p, () => schedule());
      watchers.push(w);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, path: p }, "grok: failed to watch session file");
        return;
      }
    }
    // File not present yet — watch the parent dir (if it exists) and re-arm
    // when the basename appears (Grok made the session dir but hasn't flushed
    // the file). Once the file lands, its first event reschedules and the tile
    // lights up; this is only the appears-later bootstrap, not the steady
    // state. Never mkdir.
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
    } catch (err2) {
      log?.debug(
        { err: err2, path: p },
        "grok: session path not watchable yet",
      );
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
