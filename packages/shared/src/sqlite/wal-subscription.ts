import fs from "node:fs";
import path from "node:path";
import { DEFAULT_APPEND_POLL_MS, subscribeFileAppends } from "kolu-io";
import type { Logger } from "../log.ts";

const WAL_REARM_DEBOUNCE_MS = 50;

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

function watchDirForWalRecreate(
  config: WalSubscriptionConfig,
  onWalRecreated: () => void,
  log?: Logger,
): () => void {
  const dir = path.dirname(config.dbPath);
  const walBasename = path.basename(config.walPath);
  let dirWatcher: fs.FSWatcher | null = null;
  let rearmTimer: NodeJS.Timeout | undefined;
  try {
    dirWatcher = fs.watch(dir, (_event, filename) => {
      // Some platforms / fs types report `null` filenames. Stat
      // unconditionally on null; otherwise filter to WAL-related
      // events to avoid restat'ing on every unrelated dir mutation.
      if (filename !== null && filename.toString() !== walBasename) return;
      clearTimeout(rearmTimer);
      rearmTimer = setTimeout(() => {
        rearmTimer = undefined;
        onWalRecreated();
      }, WAL_REARM_DEBOUNCE_MS);
    });
  } catch (err) {
    log?.error({ err, dir, label: config.label }, "db dir fs.watch failed");
  }
  return () => {
    clearTimeout(rearmTimer);
    rearmTimer = undefined;
    dirWatcher?.close();
  };
}

function installWalWatcher(
  onChange: () => void,
  config: WalSubscriptionConfig,
  log?: Logger,
): () => void {
  let direct: { cleanup: () => void; identity: string | null } | null = null;

  function closeDirect(): void {
    direct?.cleanup();
    direct = null;
  }

  function rebindEdgeIfInodeChanged(): void {
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

  function refreshEdgeAndKick(): void {
    rebindEdgeIfInodeChanged();
    onChange();
  }

  rebindEdgeIfInodeChanged();
  const stopDirWatch = watchDirForWalRecreate(config, refreshEdgeAndKick, log);

  return () => {
    stopDirWatch();
    closeDirect();
  };
}
