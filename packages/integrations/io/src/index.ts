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
