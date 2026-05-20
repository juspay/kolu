/**
 * Shared WAL watcher for OpenCode's database. Wraps kolu-io's executor WAL
 * adapter — refcounting, parent-dir fallback, and re-arm semantics all live
 * in the canonical shared SQLite watcher.
 */

import { subscribeExecutorWal, type Executor } from "kolu-io";
import type { Logger } from "kolu-shared";

export function subscribeOpenCodeDb(
  executor: Executor,
  dbPath: string,
  walPath: string,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  return subscribeExecutorWal(
    { executor, dbPath, walPath, label: "opencode" },
    onChange,
    onError,
    log,
  );
}
