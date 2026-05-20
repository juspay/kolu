/**
 * Shared WAL watcher for OpenCode's database. Wraps `kolu-shared`'s
 * `createWalSubscription` — the refcounted singleton, parent-dir
 * fallback, and promote-on-appearance dance all live upstream.
 *
 * Executor-aware: the function takes an `Executor` so the contract
 * matches the agent-provider's `externalChanges.install` shape, but
 * today only the local executor's filesystem is wired through
 * `createWalSubscription` (a `kolu-shared/sqlite` helper that uses
 * node's `fs.watch` directly). Calling with any other executor returns
 * a no-op subscription — without this guard, a remote terminal's
 * external-change channel would silently watch the controller's WAL
 * instead of the remote machine's, producing stale data with no failure
 * signal.
 */

import { type Executor, localExecutor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { createWalSubscription } from "kolu-shared/sqlite";
import { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

const { subscribe: subscribeOpenCodeDbLocal } = createWalSubscription({
  dbPath: OPENCODE_DB_PATH,
  walPath: OPENCODE_DB_WAL_PATH,
  label: "opencode",
});

/** Subscribe to OpenCode WAL changes against the given executor. */
export function subscribeOpenCodeDb(
  executor: Executor,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  if (executor === localExecutor) {
    return subscribeOpenCodeDbLocal(onChange, onError, log);
  }
  // Non-local executor — the controller's fs.watch can't observe the
  // remote machine's WAL. Returning a no-op preserves the
  // `externalChanges.install` contract (a stoppable handle) without
  // pretending to watch.
  log?.debug(
    {},
    "opencode: subscribeOpenCodeDb called with non-local executor — no-op",
  );
  return () => {};
}
