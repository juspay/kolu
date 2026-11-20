import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

function isExpectedSqliteRace(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /database is (locked|busy)|SQLITE_BUSY/i.test(err.message);
}

const warned = new Set<string>();

const isMissing = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === "ENOENT";

export function nudgeFiles(paths: ReadonlyArray<string | undefined>): void {
  const now = new Date();
  for (const p of paths) {
    if (!p) continue;
    try {
      fs.utimesSync(p, now, now);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
}

export function nudgeDir(dir: string | undefined): void {
  if (!dir) return;
  try {
    const probe = fs.mkdtempSync(path.join(dir, ".kolu-nudge-"));
    fs.rmSync(probe, { recursive: true });
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

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
