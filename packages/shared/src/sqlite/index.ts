/** SQLite-flavored shared utilities — connection lifecycle wrapper and
 *  refcounted WAL-file `fs.watch` subscription factory. Generic across
 *  `node:sqlite`, `better-sqlite3`, or any handle with a `close()`
 *  method; the helpers themselves don't import a SQLite driver. */

export {
  createDebounceWatcher,
  type DebounceWatcher,
  type DebounceWatcherConfig,
} from "./debounce-watcher.ts";
export {
  createWalSubscription,
  type WalSubscription,
  type WalSubscriptionConfig,
} from "./wal-subscription.ts";
export { type Closable, withDb } from "./with-db.ts";
