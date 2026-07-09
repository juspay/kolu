/**
 * Process-wide subscription on `active_sessions.json` — the external-
 * change signal that can make `resolveSession` flip without a title
 * event (Grok writes the pid map when a TUI starts, before any phase
 * event lands).
 *
 * Lazy: the orchestrator only calls `install` the first time any
 * terminal reports `isPresent`. One shared watcher for the process —
 * install is once; a second call is a no-op (same contract as codex WAL).
 *
 * Pure observer: never creates `~/.grok`. If the home dir is absent,
 * install fails soft (`installed` stays false) so a later `isPresent`
 * via `matchesAgent` can retry after Grok creates the tree.
 */

import { createDirFilenameWatcher } from "kolu-io";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { ACTIVE_SESSIONS_PATH, GROK_DIR } from "./config.ts";
import { grokHomePresent } from "./core.ts";

let installed = false;

/** Parent-dir watcher on `~/.grok`, filtered to `active_sessions.json`.
 *  Grok rewrites the file via temp+rename, which destroys an `fs.watch`
 *  pointed at the file itself — the receptacle watches the parent dir so
 *  the rename lands cleanly (same volatility the git watchers plug into). */
const activeSessionsWatcher = createDirFilenameWatcher({
  resolveDir: async () => GROK_DIR,
  filename: path.basename(ACTIVE_SESSIONS_PATH),
  debounceMs: 50,
  logLabel: "grok: active_sessions",
});

export function subscribeActiveSessions(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;

  if (!grokHomePresent()) {
    log?.debug(
      { dir: GROK_DIR },
      "grok: home dir absent — active_sessions install deferred",
    );
    return;
  }

  installed = true;

  // Once-install: subscribe for the process lifetime and discard the
  // unsubscribe (refcount stays 1 — matches the codex WAL contract). The
  // receptacle already wraps the listener in its own try/catch + log; the
  // extra guard here routes a throwing `onChange` to the adapter's
  // `onError` so a caught error surfaces rather than collapsing silently.
  activeSessionsWatcher.watch(
    "",
    () => {
      try {
        onChange();
      } catch (err) {
        onError(err);
      }
    },
    log,
  );
  log?.info(
    { path: ACTIVE_SESSIONS_PATH },
    "grok: active_sessions watcher installed",
  );
}
