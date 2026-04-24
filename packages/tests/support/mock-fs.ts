/** Cross-agent filesystem helpers for mock step definitions. */

import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Wipe all rows from the given SQLite DB **without deleting the file**.
 *
 *  Deleting the DB file between scenarios breaks the server's WAL
 *  `fs.watch` handle (Linux inotify drops on unlink; the watcher's
 *  dir-fallback may race the next fixture write). The real Codex /
 *  OpenCode CLIs keep the DB alive across turns — mirror that shape.
 *
 *  Tables not present are skipped (`sqlite_master` lookup keeps the
 *  helper agent-agnostic). DB file not existing at all is a no-op. */
export function clearMockDatabase(dbPath: string): void {
  if (!fs.existsSync(dbPath)) return;
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    for (const row of rows) {
      if (row.name.startsWith("sqlite_")) continue;
      db.exec(`DELETE FROM "${row.name}"`);
    }
  } finally {
    db.close();
  }
}
