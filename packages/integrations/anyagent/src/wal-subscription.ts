/**
 * Shared WAL subscription factory — refcounted singleton for a SQLite
 * WAL file's `fs.watch`.
 *
 * Agent integrations that observe a third-party SQLite DB (opencode,
 * codex, future candidates) all face the same problem: N concurrent
 * matched sessions watching the same WAL file = N duplicate
 * `fs.watch` handles dispatching N redundant callbacks per write.
 * The refcounted singleton collapses this to one watcher per process
 * per DB path; first subscriber lazily installs, last unsubscribe
 * tears it down.
 *
 * Each call to `createWalSubscription(...)` returns its own `subscribe`
 * function bound to a closure-private singleton, so two integrations
 * watching two different DBs get two independent singletons without
 * cross-contamination.
 *
 * Per-listener `onError` is required (not optional) so fault isolation
 * is a type-system obligation, not a convention. If one listener's
 * callback throws, its own `onError` runs, and iteration continues to
 * the next listener unaffected. See the fault-isolation snapshot in
 * the dispatch loop for the why.
 *
 * The parent-directory fallback handles the window between a thread
 * being created (row inserted in the main DB file) and the first WAL
 * frame being flushed (so the WAL file exists). When the dir watcher
 * sees the WAL appear, it promotes to a direct WAL watcher and tears
 * itself down.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "./index.ts";

/** Per-listener record tracked in the singleton's Set. */
interface WalListener {
  cb: () => void;
  onError: (err: unknown) => void;
}

/** Shape of the factory's output — a single `subscribe` function that
 *  returns an unsubscribe. Intentionally narrow: callers only need to
 *  start a listener, and the factory's closure-private state handles
 *  everything else. */
export interface WalSubscription {
  subscribe: (
    onChange: () => void,
    onError: (err: unknown) => void,
    log?: Logger,
  ) => () => void;
}

/** Configuration for a WAL subscription. */
export interface WalSubscriptionConfig {
  /** Absolute path to the SQLite DB file. Used for `path.dirname()` on
   *  the parent-directory fallback — never opened or read. */
  dbPath: string;
  /** Absolute path to the `-wal` sibling file. The actual watch target. */
  walPath: string;
  /** Short identifier included in failure log messages so operators
   *  can tell codex's WAL watcher apart from opencode's in combined
   *  logs. E.g. "codex", "opencode". */
  label: string;
}

/**
 * Build a WAL subscription bound to a specific DB + WAL path pair.
 * The returned `subscribe` function refcounts a shared `fs.watch` —
 * first subscriber installs, last unsubscribe tears down.
 *
 * Two calls with different configs produce two independent singletons.
 * A second call with the same config produces a fresh, independent
 * singleton — don't rely on factory identity for sharing; callers
 * should colocate one `createWalSubscription` call at module scope
 * and import the resulting `subscribe`.
 */
export function createWalSubscription(
  config: WalSubscriptionConfig,
): WalSubscription {
  // `sharedWalWatcher` is a single nullable structure (not a {watcher,
  // listeners} pair) so the "active iff non-empty" invariant is
  // mechanical — there's no way for the two halves to disagree.
  let sharedWalWatcher: {
    cleanup: () => void;
    listeners: Set<WalListener>;
  } | null = null;

  function subscribe(
    onChange: () => void,
    onError: (err: unknown) => void,
    log?: Logger,
  ): () => void {
    if (!sharedWalWatcher) {
      const listeners = new Set<WalListener>();
      const cleanup = installWalWatcher(
        () => {
          // Snapshot before iteration so a listener that subscribes or
          // unsubscribes synchronously can't skip a peer for this event.
          for (const l of [...listeners]) {
            try {
              l.cb();
            } catch (err) {
              l.onError(err);
            }
          }
        },
        config,
        log,
      );
      sharedWalWatcher = { cleanup, listeners };
    }
    const listener: WalListener = { cb: onChange, onError };
    sharedWalWatcher.listeners.add(listener);
    return () => {
      if (!sharedWalWatcher) return;
      sharedWalWatcher.listeners.delete(listener);
      if (sharedWalWatcher.listeners.size === 0) {
        sharedWalWatcher.cleanup();
        sharedWalWatcher = null;
      }
    };
  }

  return { subscribe };
}

/** Try to attach an fs.watch directly to the WAL file. Returns the
 *  watcher's cleanup function, or null if the file doesn't exist yet. */
function tryWatchWal(
  onChange: () => void,
  config: WalSubscriptionConfig,
  log?: Logger,
): (() => void) | null {
  try {
    const w = fs.watch(config.walPath, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Non-ENOENT (EACCES, EMFILE, etc.) means state detection for
      // this DB is broken until resolved — a real failure, not an
      // expected-absent condition. Log at error.
      log?.error(
        { err, path: config.walPath, label: config.label },
        "WAL fs.watch failed",
      );
    }
    return null;
  }
}

/** Install a single fs.watch on the WAL file, falling back to the
 *  parent directory if the WAL doesn't exist yet. When the directory
 *  watcher fires and the WAL file has appeared, promotes itself to a
 *  direct WAL watcher and tears down the directory watcher. */
function installWalWatcher(
  onChange: () => void,
  config: WalSubscriptionConfig,
  log?: Logger,
): () => void {
  const direct = tryWatchWal(onChange, config, log);
  if (direct) return direct;

  // WAL doesn't exist yet — watch the parent directory and promote
  // to the WAL file once it appears.
  let promoted: (() => void) | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  const dir = path.dirname(config.dbPath);
  try {
    dirWatcher = fs.watch(dir, () => {
      if (promoted) return;
      const walCleanup = tryWatchWal(onChange, config, log);
      if (!walCleanup) return;
      promoted = walCleanup;
      dirWatcher?.close();
      dirWatcher = null;
      // Kick — WAL may already have data written between our first
      // attempt and the directory event.
      onChange();
    });
  } catch (err) {
    // Same rationale as tryWatchWal's non-ENOENT branch: a watch
    // failure on the parent directory means we can never promote,
    // so every future state update is silently lost. Error-level.
    log?.error({ err, dir, label: config.label }, "db dir fs.watch failed");
  }
  return () => {
    dirWatcher?.close();
    promoted?.();
  };
}
