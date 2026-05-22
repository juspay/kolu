/** Nudge helpers for fs.watch / inotify recovery under parallel load.
 *
 *  Under parallel-worker load the kernel inotify queue overflows and
 *  silently drops `fs.watch` events, leaving the server's watchers
 *  wedged on stale state. The recovery is to re-fire a detectable
 *  event on each poll iteration so detection retries are driven from
 *  the test side rather than relying on the kernel queue staying warm.
 *
 *  Two flavors: `nudgeWal` writes a WAL frame to a SQLite DB
 *  (agent-session mocks); `nudgeFiles` re-touches mtimes (transcript /
 *  session-JSONL mocks). Same volatility axis, two mechanisms — they
 *  share a home so future additions don't fragment further.
 *
 *  SQLite errors that match the SQLITE_BUSY family are swallowed
 *  silently — those ARE the events we expect under contention.
 *  Anything else (schema drift, missing column, permissions) is logged
 *  once per dbPath so a regression doesn't silently re-flake the suite. */

import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Locked/busy errors are the expected failure mode under parallel
 *  contention — the surrounding poll loop will retry. Schema or
 *  permission errors are not, and must surface. */
function isExpectedSqliteRace(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /database is (locked|busy)|SQLITE_BUSY/i.test(err.message);
}

const warned = new Set<string>();

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

/** Execute `sql` against the SQLite DB at `dbPath` to force a WAL
 *  frame. No-ops if `dbPath` is undefined or the file doesn't exist
 *  (mock not yet set up — caller's poll loop will retry). */
export function nudgeWal(dbPath: string | undefined, sql: string): void {
  if (!dbPath || !fs.existsSync(dbPath)) return;
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  } catch (err) {
    if (isExpectedSqliteRace(err)) return;
    if (!warned.has(dbPath)) {
      warned.add(dbPath);
      console.warn(
        `[nudgeWal] non-transient SQLite error for ${dbPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
