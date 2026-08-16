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

import type { Logger } from "../log.ts";

/** node:sqlite reports a missing file as ERR_SQLITE_ERROR / errcode 14
 *  (SQLITE_CANTOPEN), not ENOENT. Both shapes mean "never ran here". */
export function isMissingSqliteDb(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const rec = err as { code?: unknown; errcode?: unknown };
  if (rec.code === "ENOENT") return true;
  return rec.code === "ERR_SQLITE_ERROR" && rec.errcode === 14;
}

/** Minimal shape a DB handle must satisfy to be managed by `withDb`. */
export interface Closable {
  close(): void;
}

/** The three outcomes of a read, kept apart. `withDb` folds `absent` and
 *  `failed` into one `null` because most callers act the same on both; a caller
 *  that must NOT is the case this exists for. */
export type DbRead<T> =
  | { kind: "ok"; value: T }
  /** No database to open — the tool isn't installed, or has never run here.
   *  An ANSWER: there is genuinely nothing recorded. */
  | { kind: "absent" }
  /** The database was there and the query threw. IGNORANCE, not an answer. */
  | { kind: "failed" };

/**
 * `withDb`'s three-outcome twin, for a caller that must not act on a failed read
 * as though it were an empty one.
 *
 * kolu's agent-session lookup is that caller: an empty candidate list is how a
 * terminal tells the ownership arbiter it runs no agent, and the arbiter RELEASES
 * the terminal's session on it (`padi/terminalWorkspace/sessionOwnership.ts`). A
 * transient query failure laundered into "nothing here" would hand a live
 * terminal's session to a neighbour, irreversibly, with only a log line to show
 * for it — so codex and opencode read through this and answer `null` on `failed`.
 *
 * Same lifetime contract as `withDb`: a caller-supplied `db` is borrowed, an
 * opened one is closed in a `finally`.
 */
export function readDb<Db extends Closable, T>(
  openDb: (log?: Logger) => Db | null,
  fn: (db: Db) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: Db,
): DbRead<T> {
  const ownsDb = db === undefined;
  let conn: Db | null;
  try {
    // Inside the try on purpose: `openDb` returning null is "there is no
    // database", but `openDb` THROWING is a failure to look — a locked file, a
    // permission error, EMFILE. Opening outside would have made every one of
    // those indistinguishable from absence, which is the split this exists for.
    conn = db ?? openDb(log);
  } catch (err) {
    log?.error({ err, ...errorCtx }, errorMsg);
    return { kind: "failed" };
  }
  if (!conn) return { kind: "absent" };
  const opened = conn;
  try {
    return { kind: "ok", value: fn(opened) };
  } catch (err) {
    log?.error({ err, ...errorCtx }, errorMsg);
    return { kind: "failed" };
  } finally {
    if (ownsDb) opened.close();
  }
}

/** A LIST read where absence and failure genuinely differ: `[]` when there is no
 *  database (nothing recorded), `null` when the query threw (nothing KNOWN).
 *  The shape kolu's two directory-keyed agent lookups both want, folded once
 *  here rather than as the same `match` at each of them. */
export function readDbList<Db extends Closable, T>(
  openDb: (log?: Logger) => Db | null,
  fn: (db: Db) => T[],
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
  db?: Db,
): T[] | null {
  const read = readDb(openDb, fn, errorMsg, errorCtx, log, db);
  switch (read.kind) {
    case "ok":
      return read.value;
    case "absent":
      return [];
    case "failed":
      return null;
    default:
      // A fourth outcome must force a decision here, not fall through one.
      return read satisfies never;
  }
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
  const read = readDb(openDb, fn, errorMsg, errorCtx, log, db);
  return read.kind === "ok" ? read.value : null;
}
