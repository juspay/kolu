/** kolu-io — filesystem and I/O primitives for Kolu.
 *
 *  Consumers across the workspace can adopt these primitives without taking
 *  feature-package dependencies. */

export {
  type ExecResult,
  type Executor,
  localExecutor,
  type WatchHandle,
} from "./executor.ts";

export {
  subscribeExecutorWal,
  type ExecutorWalSubscriptionConfig,
} from "./executor-wal.ts";

export type { Host } from "./host.ts";

export {
  createDirFilenameWatcher,
  type DirFilenameWatcher,
  type DirFilenameWatcherConfig,
} from "./refcounted-dir-watcher.ts";
