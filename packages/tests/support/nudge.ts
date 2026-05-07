/** WAL-nudge helper for mock SQLite-backed agent integrations.
 *
 *  Under parallel-worker load the kernel inotify queue overflows and
 *  silently drops `fs.watch` events, leaving the server's session
 *  watcher wedged on stale state. The recovery is to re-fire a fresh
 *  WAL frame on each poll iteration so detection retries are driven
 *  from the test side rather than relying on the kernel queue staying
 *  warm. Mirror of `claude_code_steps.ts::nudgeMockFiles` (which uses
 *  `fs.utimesSync` for the file-watcher case).
 *
 *  Errors that match the SQLITE_BUSY family are swallowed silently —
 *  these ARE the events we expect under contention. Anything else
 *  (schema drift, missing column, permissions) is logged once per
 *  dbPath so a regression doesn't silently re-flake the suite. */

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
