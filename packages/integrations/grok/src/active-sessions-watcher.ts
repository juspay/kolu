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
 * Total install: `install` never soft-fails. When `~/.grok` does not
 * exist yet (a first-ever Grok launch on a fresh home), it watches the
 * parent dir for `.grok` appearing and then attaches the real
 * active_sessions watcher — so padi's once-install latch stays valid and
 * the external-change signal is never permanently lost. Pure observer:
 * never creates `~/.grok`; the bootstrap only waits for Grok to create
 * its own tree (same promote-on-appearance dance the codex WAL
 * subscription does upstream).
 */

import { createDirWatcher } from "kolu-io";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { ACTIVE_SESSIONS_PATH, GROK_DIR } from "./config.ts";
import { grokHomePresent } from "./core.ts";

let installed = false;

/** Parent-dir watcher on `~/.grok`, filtered to `active_sessions.json`.
 *  Grok rewrites the file via temp+rename, which destroys an `fs.watch`
 *  pointed at the file itself — the receptacle watches the parent dir so
 *  the rename lands cleanly (same volatility the git watchers plug into). */
const activeSessionsWatcher = createDirWatcher({
  resolveDir: async () => GROK_DIR,
  filename: path.basename(ACTIVE_SESSIONS_PATH),
  debounceMs: 50,
  logLabel: "grok: active_sessions",
});

/** Attach the shared `active_sessions.json` watcher for the process
 *  lifetime. The receptacle already wraps the listener in its own
 *  try/catch + log and logs its own install/retire lifecycle; the extra
 *  guard here routes a throwing `onChange` to the adapter's `onError` so a
 *  caught error surfaces rather than collapsing silently. The unsubscribe
 *  is discarded on purpose (refcount stays 1 — matches the codex WAL
 *  contract). */
function attach(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
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
}

export function subscribeActiveSessions(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;
  // Latch immediately: install is total from here, so a second `install`
  // call (a later terminal reporting `isPresent`) correctly no-ops even
  // while the bootstrap below is still waiting for `~/.grok` to appear.
  installed = true;

  if (grokHomePresent()) {
    attach(onChange, onError, log);
    return;
  }

  // Home dir absent (first-ever Grok launch on a fresh home). Never mkdir:
  // watch the parent dir (which always exists) for `.grok` appearing, then
  // attach the real watcher. Without this, install would soft-fail here and
  // padi's once-install latch would prevent any retry, permanently killing
  // the external-change signal for the process.
  const parent = path.dirname(GROK_DIR);
  const base = path.basename(GROK_DIR);
  let bootstrap: fs.FSWatcher | null = null;
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;

  // Promote to the real watcher once `~/.grok` exists: close the bootstrap and
  // attach. Idempotent (the `!bootstrap` guard) so it's safe to call from both
  // the debounced dir event and the one-shot post-install reconcile below.
  const promoteIfPresent = (): void => {
    if (!grokHomePresent() || !bootstrap) return;
    bootstrap.close();
    bootstrap = null;
    if (bootstrapTimer) {
      clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }
    // Exact grep-able watcher-retired phrase (matches the receptacle's
    // install/retire pair) so operator watcher-count correlation sees this
    // bootstrap close; the reason (real active_sessions watcher now attaching)
    // lives in this comment.
    log?.info({ dir: GROK_DIR, parent }, "grok: home-dir watcher retired");
    attach(onChange, onError, log);
  };

  try {
    bootstrap = fs.watch(parent, (_evt, filename) => {
      // `filename` is null on some platforms; re-check presence regardless.
      if (filename !== base && filename !== null) return;
      // Trailing-edge debounce: `parent` is $HOME (a busy dir) and a null
      // `filename` (macOS) matches every event, so an unguarded
      // grokHomePresent() stat would run on nearly every home-dir change.
      if (bootstrapTimer) clearTimeout(bootstrapTimer);
      bootstrapTimer = setTimeout(promoteIfPresent, 50);
    });
  } catch (err) {
    // The home dir itself is unwatchable — surface it; the pid-match path
    // (resolveSession reads active_sessions.json fresh) still works.
    onError(err);
    return;
  }
  // Exact grep-able watcher-installed phrase (matches the receptacle's
  // `createDirWatcher` install log) so this long-lived bootstrap
  // watcher shows up in operator watcher-count correlation; the reason (real
  // active_sessions install deferred until ~/.grok appears) lives here.
  log?.info({ dir: GROK_DIR, parent }, "grok: home-dir watcher installed");
  // Close the resolve→install TOCTOU window: `~/.grok` may have been created
  // between the grokHomePresent() check above and the fs.watch install, and a
  // quiet home dir might never fire another event. Re-check once, now.
  promoteIfPresent();
}
