/** kolu-io — filesystem and I/O primitives for Kolu.
 *
 *  The `Executor` interface and the default `localExecutor` are the
 *  abstraction every higher-level integration package (kolu-git, the
 *  agent providers) uses to talk to "the filesystem and a process
 *  launcher" without committing to whether that filesystem is local or
 *  routed through an SSH helper. `Host` extends `Executor` with PTY
 *  spawning + identity so the terminal orchestrator can program against
 *  the same shape. */

export {
  type ExecResult,
  type Executor,
  localExecutor,
  type WatchHandle,
} from "./executor.ts";
export { type HomeLogger, resolveExecutorHome } from "./home.ts";
export { type Host, type HostLogger } from "./host.ts";
export {
  createDirFilenameWatcher,
  type DirFilenameWatcher,
  type DirFilenameWatcherConfig,
} from "./refcounted-dir-watcher.ts";
