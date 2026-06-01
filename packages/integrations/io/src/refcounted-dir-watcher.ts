/**
 * Generic refcounted shared `fs.watch` watcher keyed by directory.
 *
 * The directory is the watch target, not the file: most editors and tools
 * rewrite files via temp+rename, which destroys an `fs.watch` handle pointed
 * at the original file. A parent-directory watcher catches the rename event
 * cleanly on both Linux inotify and macOS FSEvents.
 *
 * Refcounted singleton per resolved dir: first subscribe installs, last
 * unsubscribe tears down and drops the registry entry. Idempotent
 * unsubscribe; teardown clears the debounce timer so late callbacks can't
 * fire on a closed watcher.
 */

import type { Logger } from "@kolu/log";
import fs from "node:fs";

interface SharedFilenameWatcher {
  subscribe(onChange: () => void): () => void;
  /** Test-only: tear down the underlying `fs.watch` handle and clear the
   *  debounce timer, regardless of subscriber count. Invoked by
   *  `DirFilenameWatcher._reset()` to break the module-scope leak that
   *  cascades vitest `afterEach` failures (see #955). */
  _forceClose(): void;
}

export interface DirFilenameWatcherConfig {
  /** Resolve cwd → absolute directory to watch, or null to skip install
   *  silently. Called once per `watch()` invocation; the result keys the
   *  registry. */
  resolveDir: (cwd: string) => string | null;
  /** Filename inside `resolveDir(cwd)` that fires the listener. Other
   *  events on the directory are ignored. */
  filename: string;
  /** Trailing-edge debounce window in milliseconds. */
  debounceMs: number;
  /** Lifecycle log label, e.g. `"git: head"`. Combined with `installed` /
   *  `retired` / `listener threw` for log lines. */
  logLabel: string;
}

export interface DirFilenameWatcher {
  /** Subscribe to file events on the resolved dir/filename pair. Returns
   *  a no-op cleanup if `resolveDir` returned null. */
  watch(cwd: string, onChange: () => void, log?: Logger): () => void;
  /** Test-only inspector — number of distinct resolved dirs with active
   *  shared watchers. Used by unit tests to assert the singleton invariant
   *  without spying on `fs.watch`. */
  _watcherCount(): number;
  /** Test-only teardown — close every active watcher and clear the
   *  registry, regardless of subscriber count. Used in vitest `beforeEach`
   *  to break the module-scope leak that turns one timed-out test into a
   *  whole-file cascade (#955). Production code must never call this. */
  _reset(): void;
}

/**
 * Build a `watch(cwd, onChange, log) → unsubscribe` function with a private
 * registry, plus a test-only `_watcherCount()` inspector. Each call to
 * `createDirFilenameWatcher` produces an independent singleton — don't call
 * it twice with the same config and expect sharing.
 */
export function createDirFilenameWatcher(
  config: DirFilenameWatcherConfig,
): DirFilenameWatcher {
  const watchers = new Map<string, SharedFilenameWatcher>();

  function install(
    dir: string,
    onLast: () => void,
    log?: Logger,
  ): SharedFilenameWatcher | null {
    const listeners = new Set<() => void>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, (_, filename) => {
        if (filename !== config.filename) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          // Snapshot before iteration so a listener that unsubscribes
          // synchronously can't skip a peer for this event.
          for (const cb of [...listeners]) {
            try {
              cb();
            } catch (e) {
              log?.error(
                { err: e instanceof Error ? e.message : String(e), dir },
                `${config.logLabel} listener threw`,
              );
            }
          }
        }, config.debounceMs);
      });
    } catch (e) {
      log?.error(
        { err: e instanceof Error ? e.message : String(e), dir },
        `${config.logLabel} failed to watch dir`,
      );
      return null;
    }
    log?.info({ dir }, `${config.logLabel} watcher installed`);

    return {
      subscribe(onChange) {
        listeners.add(onChange);
        return () => {
          // `Set.delete` returns false if `onChange` was already removed —
          // double-call from the same caller can't double-tear-down. A
          // later subscribe under the same dir installs a fresh singleton;
          // this closure stays bound to the old one, so it can't
          // accidentally tear that fresh entry down.
          if (!listeners.delete(onChange)) return;
          if (listeners.size === 0) {
            if (timer) clearTimeout(timer);
            watcher.close();
            onLast();
            log?.info({ dir }, `${config.logLabel} watcher retired`);
          }
        };
      },
      _forceClose() {
        listeners.clear();
        if (timer) clearTimeout(timer);
        watcher.close();
      },
    };
  }

  return {
    watch(cwd, onChange, log) {
      const dir = config.resolveDir(cwd);
      if (dir === null) return () => {};
      let entry = watchers.get(dir);
      if (!entry) {
        const fresh = install(dir, () => watchers.delete(dir), log);
        if (!fresh) return () => {};
        watchers.set(dir, fresh);
        entry = fresh;
      }
      return entry.subscribe(onChange);
    },
    _watcherCount: () => watchers.size,
    _reset() {
      for (const entry of watchers.values()) entry._forceClose();
      watchers.clear();
    },
  };
}
