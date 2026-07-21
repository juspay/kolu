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
import { DEFAULT_APPEND_POLL_MS, subscribeFileAppends } from "kolu-io";
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
  // The direct WAL subscription and the inode identity it was armed on. The
  // subscription is `subscribeFileAppends` (an `fs.watch` edge + an
  // `fs.watchFile` floor, juspay/kolu#1754): the floor follows the PATH, so a
  // single subscription already survives the WAL's appearance, appends, AND
  // inode replacement — the `identity` is kept only to refresh the fast-path
  // EDGE when a checkpoint recreates the WAL under a new inode. `identity` may
  // be null (WAL absent): the floor tolerates that and fires on appearance, so
  // — unlike the old direct `fs.watch` — arming never has to wait for the file.
  let direct: { cleanup: () => void; identity: string | null } | null = null;

  function closeDirect(): void {
    direct?.cleanup();
    direct = null;
  }

  /** Arm (or refresh) the direct WAL subscription. Subscribes unconditionally
   *  — the floor covers an absent-then-appearing WAL — and re-subscribes only
   *  when the inode changed, so the fast-path edge re-binds to the recreated
   *  WAL after a checkpoint. A same-inode call is a no-op. */
  function armDirect(): void {
    const nextIdentity = walIdentity(config, log);
    if (direct && direct.identity === nextIdentity) return;
    closeDirect();
    const cleanup = subscribeFileAppends(config.walPath, onChange, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: `${config.label}: wal`,
    });
    direct = { cleanup, identity: nextIdentity };
  }

  armDirect();

  // Coalesce parent-directory events at `WAL_REARM_DEBOUNCE_MS` (50 ms)
  // so a flurry of file writes reported through the directory inode
  // doesn't re-stat per event. This is independent of, and shorter
  // than, the integration-level debounce that the callers (e.g.
  // `createDebounceWatcher` at 150 ms) layer on top: in the common case
  // both the direct WAL watcher and this dir-event path fire on the
  // same write, the integration-level debounce collapses both into one
  // `onChange` payload.
  let rearmTimer: NodeJS.Timeout | null = null;
  function runRearm(): void {
    rearmTimer = null;
    // Refresh the edge if the inode changed (a no-op otherwise), then kick:
    // a WAL-named parent-dir event means the WAL may have changed — and on a
    // same-size same-inode checkpoint rewrite this unconditional kick is what
    // recovers it (proven), since neither the stat identity nor a coarse-mtime
    // key would. The integration-level debounce + change gate absorb duplicates.
    armDirect();
    onChange();
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
