/** Cross-agent filesystem helpers for mock step definitions. */

import * as fs from "node:fs";

/** Delete a SQLite DB and its WAL/SHM sidecars if they exist.
 *
 *  Narrows the swallowed-error window to genuine transient-lock codes
 *  (`EBUSY`, `EAGAIN`) that can arise when the server's reader
 *  connection is mid-release. Anything else — `EACCES`, `ENOSPC`, or a
 *  stale `ENOENT` after `existsSync` — propagates so the cleanup bug
 *  surfaces instead of hiding inside a cryptic "database locked"
 *  failure in the next scenario's fixture write. */
export function cleanupMockDatabase(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!fs.existsSync(p)) continue;
    try {
      fs.unlinkSync(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EAGAIN") throw err;
    }
  }
}
