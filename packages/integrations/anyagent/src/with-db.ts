/**
 * Shared `withDb` wrapper — run a function against a SQLite handle and
 * close it on the way out, with uniform error handling.
 *
 * Extracted from opencode + codex (byte-identical copies). Both read
 * their upstream's SQLite DB in WAL mode via `node:sqlite`'s
 * `DatabaseSync`; the body of this helper knows nothing about SQLite
 * specifically — it only requires that the handle type has a
 * `close()` method, so it works for any handle that follows the same
 * contract (better-sqlite3, future Node built-ins, etc.).
 *
 * Design points:
 *   - If `db` is passed, the caller owns the connection's lifetime
 *     (commonly the case inside a long-lived watcher that hoists one
 *     connection across many refreshes). The wrapper won't close it.
 *   - If `db` is absent, the wrapper opens one via `openDb(log)`, runs
 *     `fn`, and closes it in a `finally`. This is for one-shot
 *     queries that don't justify caller-held state.
 *   - `fn` throws are caught and logged at `error` with `errorCtx`
 *     merged in for context, returning `null` to the caller. Callers
 *     that need to distinguish "no rows" from "query failed" should
 *     not use this wrapper for that query.
 */

import type { Logger } from "./index.ts";

/** Minimal shape a DB handle must satisfy to be managed by `withDb`. */
export interface Closable {
  close(): void;
}

/**
 * Run `fn` against a SQLite-like handle. If `db` is provided, uses it
 * without owning it (caller manages lifecycle). If absent, opens a
 * fresh connection via `openDb` and closes it after `fn` returns.
 * Returns null if the DB can't be opened or if `fn` throws.
 *
 * Type parameters are inferred from `openDb`'s return type, so each
 * integration keeps its own concrete handle type (`DatabaseSync` from
 * `node:sqlite`) without `withDb` carrying a `node:sqlite` dependency.
 */
export function withDb<Db extends Closable, T>(
  openDb: (log?: Logger) => Db | null,
  fn: (db: Db) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: Db,
): T | null {
  const ownsDb = db === undefined;
  const conn = db ?? openDb(log);
  if (!conn) return null;
  try {
    return fn(conn);
  } catch (err) {
    log?.error({ err, ...errorCtx }, errorMsg);
    return null;
  } finally {
    if (ownsDb) conn.close();
  }
}
