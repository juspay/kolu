/** kolu-io — filesystem and I/O primitives for Kolu.
 *
 *  Standalone integration package with no `kolu-*` dependencies — only
 *  third-party packages and the Node stdlib. Consumers across the workspace
 *  can adopt these primitives without taking a feature-package dependency. */

export {
  createDirFilenameWatcher,
  type DirFilenameWatcher,
  type DirFilenameWatcherConfig,
} from "./refcounted-dir-watcher.ts";

export {
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
  type SubscribeFileAppendsOpts,
} from "./file-append-watcher.ts";

export {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  type CoalesceSchedule,
  type CoalesceScheduleOpts,
} from "./coalesce-schedule.ts";
