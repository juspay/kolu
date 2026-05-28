/** @kolu/dir-watch — refcounted shared `fs.watch` watcher keyed by
 *  directory, with single-file dispatch.
 *
 *  Zero `kolu-*` dependencies — only Node stdlib + an optional pino-
 *  shaped Logger. Externalizable as-is; lives in the workspace
 *  alongside the other `@kolu/*` published-shape packages. */

export {
  createDirFilenameWatcher,
  type DirFilenameWatcher,
  type DirFilenameWatcherConfig,
} from "./refcounted-dir-watcher.ts";
