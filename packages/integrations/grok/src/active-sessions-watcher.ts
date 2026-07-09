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

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { ACTIVE_SESSIONS_PATH, GROK_DIR } from "./config.ts";

let installed = false;
let onFire: (() => void) | null = null;
let onErr: ((err: unknown) => void) | null = null;

export function subscribeActiveSessions(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;

  if (!fs.existsSync(GROK_DIR)) {
    log?.debug(
      { dir: GROK_DIR },
      "grok: home dir absent — active_sessions install deferred",
    );
    return;
  }

  installed = true;
  onFire = onChange;
  onErr = onError;

  const fire = () => {
    if (!onFire) return;
    try {
      onFire();
    } catch (err) {
      onErr?.(err);
    }
  };

  try {
    // Process-lifetime watcher — never closed (matches codex WAL subscribe).
    fs.watch(GROK_DIR, (_evt, filename) => {
      if (
        filename === path.basename(ACTIVE_SESSIONS_PATH) ||
        filename === `${path.basename(ACTIVE_SESSIONS_PATH)}.tmp` ||
        filename === `${path.basename(ACTIVE_SESSIONS_PATH)}.lock`
      ) {
        fire();
      }
    });
    log?.info(
      { path: ACTIVE_SESSIONS_PATH },
      "grok: active_sessions watcher installed",
    );
  } catch (err) {
    log?.error({ err, path: GROK_DIR }, "grok: failed to watch home dir");
    installed = false;
    onFire = null;
    onErr = null;
  }
}
