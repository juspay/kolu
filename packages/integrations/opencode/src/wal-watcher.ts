/**
 * Shared WAL watcher — refcounted singleton for `opencode.db-wal`.
 *
 * Every OpenCodeWatcher wants to react to WAL changes. Rather than have
 * each create its own fs.watch (N sessions = N duplicate watchers + N
 * duplicate dispatches per event), this module refcounts a single
 * watcher: first subscriber lazily installs it, last unsubscribe tears
 * it down.
 *
 * `sharedWalWatcher` is a single nullable structure (not a {watcher,
 * listeners} pair) so the "active iff non-empty" invariant is
 * mechanical — there's no way for the two halves to disagree.
 *
 * Per-listener `onError` is required (not optional) so fault isolation
 * is a type-system obligation, not a convention. If one listener's
 * callback throws, its own onError runs, and iteration continues to
 * the next listener unaffected.
 *
 * Mirrors `subscribeSessionsDir` in kolu-claude-code.
 */

import { subscribeSqliteWal } from "anyagent";
import { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";
import type { Logger } from "anyagent";

/**
 * Subscribe to changes in OpenCode's SQLite WAL file. Returns an
 * unsubscribe function. The underlying `fs.watch` is shared across all
 * subscribers — refcounted, installed on first subscribe, torn down on
 * last unsubscribe.
 *
 * `onError` receives any exception thrown by `onChange` and runs in
 * place of breaking the iteration over peer listeners. Callers must
 * provide one (silent swallowing would hide bugs) — pass a logger call
 * like `(err) => log.warn({ err }, "...")`.
 */
export function subscribeOpenCodeDb(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  return subscribeSqliteWal(
    OPENCODE_DB_PATH,
    OPENCODE_DB_WAL_PATH,
    onChange,
    onError,
    log,
  );
}
