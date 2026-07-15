/** Nudge helpers for fs.watch / inotify recovery under parallel load.
 *
 *  Under parallel-worker load the kernel inotify queue overflows and
 *  silently drops `fs.watch` events, leaving the server's watchers
 *  wedged on stale state. The recovery is to re-fire a detectable
 *  event on each poll iteration so detection retries are driven from
 *  the test side rather than relying on the kernel queue staying warm.
 *
 *  `nudgeFiles` re-touches mtimes and `nudgeDir` create+unlinks a
 *  sentinel — both used by the code-tab live-reload path. (Agent-session
 *  mocks used to nudge here too; that moved INTO the in-terminal
 *  mock-agent's own self-nudge — packages/mock-agent — so no test-side
 *  DB write remains.) */

import * as fs from "node:fs";
import * as path from "node:path";

/** Re-touch each existing file's mtime to re-fire its parent dir's
 *  `fs.watch`. Used by mock agent integrations whose session/transcript
 *  files are the trigger the server polls for. Undefined or
 *  non-existent paths are silently skipped — the caller's poll loop
 *  retries on the next tick. */
export function nudgeFiles(paths: ReadonlyArray<string | undefined>): void {
  const now = new Date();
  for (const p of paths) {
    if (!p) continue;
    try {
      fs.utimesSync(p, now, now);
    } catch {
      // File may have been cleaned up between iterations — fine.
    }
  }
}

/** Re-fire a directory's `fs.watch` by creating then removing a throwaway
 *  sentinel entry inside it. `nudgeFiles` re-touches mtimes, which only
 *  recovers a dropped *write/create* event — it can do nothing for a
 *  dropped *deletion* (the file is gone, so there's nothing left to
 *  touch). A create+unlink of a sentinel inside `dir` produces fresh
 *  entry events, so a consumer that re-scans on any directory event (e.g.
 *  the Claude SESSIONS_DIR watcher, which re-reads `<pid>.json` and finds
 *  it absent) re-derives and notices the real entry has vanished. The
 *  sentinel name is deliberately not a `*.json` so no session enumerator
 *  ever parses it. Undefined / non-existent dir / racing cleanup is
 *  swallowed — the caller's poll loop retries on the next tick. */
export function nudgeDir(dir: string | undefined): void {
  if (!dir) return;
  try {
    const probe = fs.mkdtempSync(path.join(dir, ".kolu-nudge-"));
    fs.rmSync(probe, { recursive: true });
  } catch {
    // Dir may not exist yet or be mid-cleanup — fine; poll loop retries.
  }
}
