/**
 * Process-wide subscription on the per-cwd session directories — the
 * external-change signal that can make `resolveSession` flip without a
 * title event (Xyne's runtime writes the transcript + summary on its own
 * schedule; nothing here is title-driven).
 *
 * Why a dir watcher and not a title event: Xyne creates a NEW transcript
 * file per session inside `sessions/<encoded-cwd>/` — no long-lived pid
 * map like Grok's `active_sessions.json`. The newest transcript in the cwd
 * dir IS the session identity; this watcher is the rewake that lands it.
 *
 * Lazy: the orchestrator only calls `install` the first time any terminal
 * reports `isPresent`. One shared watcher for the process — install is
 * once; a second call is a no-op (same contract as codex WAL / grok).
 *
 * Pure observer: never creates `~/.xyne`. When the sessions tree does not
 * exist yet (a first-ever Xyne launch on a fresh home), it watches the
 * nearest existing ancestor for the tree appearing and then attaches the
 * real dir watcher — so padi's once-install latch stays valid and the
 * external-change signal is never permanently lost.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import { xyneSessionsPresent } from "./core.ts";

let installed = false;

export function subscribeSessionDirs(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;
  // Latch immediately: install is total from here, so a second `install`
  // call (a later terminal reporting `isPresent`) correctly no-ops even
  // while the bootstrap below is still waiting for the tree to appear.
  installed = true;

  const fire = (): void => {
    try {
      onChange();
    } catch (err) {
      onError(err);
    }
  };

  watchSessionsDir(SESSIONS_DIR, fire, log);
  log?.info({ dir: SESSIONS_DIR }, "xyne: sessions watcher installed");
}

/** Watch `dir` for transcript writes, falling back to the nearest existing
 *  ancestor for the dir's appearance when it does not exist yet
 *  (first-ever launch on a fresh home). An `fs.watch` on a watched dir
 *  dies with it, so the fallback must re-poll the root until it lands —
 *  same promote-on-appearance dance the grok / codex watchers use. */
function watchSessionsDir(dir: string, fire: () => void, log?: Logger): void {
  if (xyneSessionsPresent()) {
    try {
      // Non-recursive on purpose: a new transcript is a file-create inside
      // `sessions/<encoded-cwd>/`, and a summary/title update is a write
      // inside the same two levels. A recursive watch (darwin's FSEvents
      // default) would drag in every subdir Xyne adds later.
      fs.watch(dir, { recursive: true }, () => fire());
      return;
    } catch (err) {
      log?.error({ err, dir }, "xyne: sessions dir not watchable");
      return;
    }
  }
  // Tree absent — watch the nearest existing ancestor and re-arm when a
  // path component below `dir` appears. Cheapest correct bootstrap: poll
  // the ancestor dir; when the root finally exists, promote to the real
  // watch above. Never mkdir.
  let ancestor = path.dirname(dir);
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) {
    ancestor = path.dirname(ancestor);
  }
  try {
    const w = fs.watch(ancestor, () => {
      if (!xyneSessionsPresent()) return;
      w.close();
      watchSessionsDir(dir, fire, log);
    });
    void w;
  } catch (err) {
    // No ancestor to watch (a truly empty home): give up loudly — detection
    // becomes title-event-only for this process, which the honest `state`
    // already absorbs.
    log?.error(
      { err, dir: ancestor },
      "xyne: no watchable ancestor for sessions",
    );
  }
}
