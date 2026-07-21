/**
 * GrokWatcher — per-session lifecycle. Watches `events.jsonl` +
 * `summary.json` + `signals.json` with a trailing-edge debounce and emits
 * GrokInfo on change, gated by `agentInfoEqual`.
 *
 * Pure observer: never creates paths under `~/.grok`. If a file is
 * missing, watches its parent directory (when that exists) and re-arms
 * when the basename appears — same observe-without-mutate idea as
 * Claude's session watchers.
 */

import fs from "node:fs";
import path from "node:path";
import { agentInfoEqual } from "anyagent";
import { DEFAULT_APPEND_POLL_MS, subscribeFileAppends } from "kolu-io";
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
  // Unsubscribes for the append-robust floor (juspay/kolu#1754), torn down
  // alongside the raw watchers.
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

  // events.jsonl is the primary state signal. Wrap it in the append-robust
  // floor (juspay/kolu#1754): a dropped/coalesced terminal-append edge — macOS
  // kqueue especially — would otherwise strand the tile on a transient state
  // forever (grok has no other fallback timer). Subscribe UNCONDITIONALLY (the
  // Q7 reversal): grok's old dir-watch bootstrap never re-armed a file watch
  // after events.jsonl appeared and kqueue dir-watches never fire on child
  // content appends, so a session matched before the file was flushed got no
  // steady-state watch on macOS at all. The floor tolerates absence and fires
  // on appearance, closing that hole with the same mechanism.
  cleanups.push(
    subscribeFileAppends(session.eventsPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "grok: events",
    }),
  );
  // summary.json / signals.json stay edge-only (dir-watch bootstrap for the
  // temp+rename rewrite). Both are re-read on every events.jsonl tick, so a
  // dropped edge there only staleness the model/title/token display until the
  // next events tick — a display-freshness residual, not a state lie (Q6).
  watchPath(session.summaryPath);
  // signals.json carries contextTokensUsed — re-emit when the window moves.
  watchPath(session.signalsPath);
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
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* ignore unsubscribe races */
        }
      }
      cleanups.length = 0;
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
