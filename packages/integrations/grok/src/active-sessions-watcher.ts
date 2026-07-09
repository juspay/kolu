/**
 * Process-wide subscription on `active_sessions.json` — the external-
 * change signal that can make `resolveSession` flip without a title
 * event (Grok writes the pid map when a TUI starts, before any phase
 * event lands).
 *
 * Lazy: the orchestrator only calls `install` the first time any
 * terminal reports `isPresent`. One shared watcher for the process.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { ACTIVE_SESSIONS_PATH, GROK_DIR } from "./config.ts";

let installed = false;
const listeners = new Set<() => void>();

export function subscribeActiveSessions(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  listeners.add(onChange);
  if (installed) return;
  installed = true;

  try {
    fs.mkdirSync(GROK_DIR, { recursive: true });
  } catch (err) {
    log?.debug({ err, dir: GROK_DIR }, "grok: could not ensure home dir");
  }

  const fire = () => {
    for (const l of listeners) {
      try {
        l();
      } catch (err) {
        onError(err);
      }
    }
  };

  try {
    // Process-lifetime watcher — never closed (matches codex WAL subscribe).
    // Watch the parent dir so we catch create + rewrite of the file.
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
  }
}
