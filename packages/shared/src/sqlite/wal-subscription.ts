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
 * The parent-directory watcher handles two concerns:
 *
 *   1. The startup window between a row being inserted in the main DB
 *      file and the first WAL frame being flushed (so the WAL file
 *      exists). The directory watcher sees the WAL appear and arms a
 *      direct `fs.watch` on it.
 *   2. SQLite WAL inode replacement. After the last writer closes,
 *      SQLite can checkpoint, delete, and recreate the `-wal` file
 *      under a new inode. A direct `fs.watch` on the *old* inode
 *      silently never fires again. The directory watcher detects the
 *      recreate and re-arms the direct watch on the new inode.
 *
 * The directory watcher therefore stays alive for the lifetime of the
 * subscription, alongside the direct watcher — never torn down on
 * promotion.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../log.ts";

/** Debounce window for parent-directory events before stat'ing the WAL
 *  inode. Direct WAL events already flow through the integration-level
 *  debounce; this timer keeps the inode-replacement detection path
 *  cheap if the OS also reports file writes as directory events. */
const WAL_REARM_DEBOUNCE_MS = 50;

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
      log?.info(
        { walPath: config.walPath },
        `${config.label}: wal watcher installed`,
      );
    }
    const listener: WalListener = { cb: onChange, onError };
    sharedWalWatcher.listeners.add(listener);
    return () => {
      if (!sharedWalWatcher) return;
      sharedWalWatcher.listeners.delete(listener);
      if (sharedWalWatcher.listeners.size === 0) {
        sharedWalWatcher.cleanup();
        sharedWalWatcher = null;
        log?.info(
          { walPath: config.walPath },
          `${config.label}: wal watcher retired`,
        );
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

/** Stat the WAL file and return its `dev:inode` identity, or null if the
 *  file doesn't exist. Used by the directory watcher to detect inode
 *  replacement — a fresh WAL file with the same path but a different
 *  inode means SQLite checkpointed and the previous direct `fs.watch`
 *  is bound to a dead inode. */
function walIdentity(
  config: WalSubscriptionConfig,
  log?: Logger,
): string | null {
  try {
    const stat = fs.statSync(config.walPath);
    return `${stat.dev}:${stat.ino}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: config.walPath, label: config.label },
        "WAL stat failed",
      );
    }
    return null;
  }
}

/** Install a direct `fs.watch` on the WAL file plus a parent-directory
 *  watcher that keeps the direct watch attached to the current WAL inode.
 *  SQLite can delete and recreate the WAL during checkpoint (especially
 *  in tests where the mock writer opens and closes the DB per state
 *  update); the directory watcher detects the recreate and re-arms the
 *  direct watch. */
function installWalWatcher(
  onChange: () => void,
  config: WalSubscriptionConfig,
  log?: Logger,
): () => void {
  let directCleanup: (() => void) | null = null;
  let directIdentity: string | null = null;

  function closeDirect(): void {
    directCleanup?.();
    directCleanup = null;
    directIdentity = null;
  }

  /** Ensure the direct WAL watcher is attached to the current inode.
   *  Returns true if a watcher is now active, false if the WAL is
   *  gone (the directory watcher will pick the next recreate up). */
  function armDirect(): boolean {
    const nextIdentity = walIdentity(config, log);
    if (!nextIdentity) {
      closeDirect();
      return false;
    }
    if (directCleanup && directIdentity === nextIdentity) return true;
    const nextCleanup = tryWatchWal(onChange, config, log);
    if (!nextCleanup) {
      closeDirect();
      return false;
    }
    closeDirect();
    directCleanup = nextCleanup;
    directIdentity = nextIdentity;
    return true;
  }

  armDirect();

  // Coalesce parent-directory events so a flurry of file writes
  // reported through the directory inode doesn't re-stat per event.
  let rearmTimer: NodeJS.Timeout | null = null;
  function runRearm(): void {
    rearmTimer = null;
    const hadDirect = directCleanup !== null;
    const hasDirect = armDirect();
    // Kick — between the prior watcher closing and the new one
    // arming, WAL writes may have been missed. The integration-level
    // debounce absorbs duplicates if the direct watcher also fires.
    if (hadDirect || hasDirect) onChange();
  }
  function scheduleRearm(): void {
    if (rearmTimer) clearTimeout(rearmTimer);
    rearmTimer = setTimeout(runRearm, WAL_REARM_DEBOUNCE_MS);
  }

  let dirWatcher: fs.FSWatcher | null = null;
  const dir = path.dirname(config.dbPath);
  const walBasename = path.basename(config.walPath);
  try {
    dirWatcher = fs.watch(dir, (_event, filename) => {
      // Some platforms / fs types report `null` filenames. Stat
      // unconditionally on null; otherwise filter to WAL-related
      // events to avoid restat'ing on every unrelated dir mutation.
      if (filename !== null && filename.toString() !== walBasename) return;
      scheduleRearm();
    });
  } catch (err) {
    // A watch failure on the parent directory means we can never
    // recover from WAL inode replacement, so future state updates
    // can silently disappear once the current direct watcher's
    // inode is reaped. Error-level.
    log?.error({ err, dir, label: config.label }, "db dir fs.watch failed");
  }
  return () => {
    if (rearmTimer) {
      clearTimeout(rearmTimer);
      rearmTimer = null;
    }
    dirWatcher?.close();
    closeDirect();
  };
}
