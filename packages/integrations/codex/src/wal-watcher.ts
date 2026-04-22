/**
 * Refcounted singleton WAL watcher for Codex's SQLite state database.
 *
 * Codex writes thread metadata to a SQLite database whose journal mode is WAL.
 * We watch the WAL file (`state_5.sqlite-wal`) for changes to detect when
 * threads appear, get renamed, or are archived — without polling.
 *
 * The watcher is promoted: if the WAL file doesn't exist yet (no codex session
 * has run on this machine), we watch the parent directory and promote to a WAL
 * watcher once the file appears.
 *
 * Multiple subscribers share one fs.watch instance via refcounting. When the
 * last subscriber unsubscribes, the watcher is torn down.
 */
import fs from "node:fs";
import path from "node:path";
import { CODEX_STATE_DB_PATH, CODEX_STATE_DB_WAL_PATH } from "./config.ts";
import type { Logger } from "anyagent";

interface WalListener {
  cb: () => void;
  onError: (err: unknown) => void;
}

let sharedWalWatcher: {
  cleanup: () => void;
  listeners: Set<WalListener>;
} | null = null;

export function subscribeCodexDb(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  if (!sharedWalWatcher) {
    const listeners = new Set<WalListener>();
    const cleanup = installWalWatcher(() => {
      for (const l of [...listeners]) {
        try {
          l.cb();
        } catch (err) {
          l.onError(err);
        }
      }
    }, log);
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

function tryWatchWal(onChange: () => void, log?: Logger): (() => void) | null {
  try {
    const w = fs.watch(CODEX_STATE_DB_WAL_PATH, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug({ err, path: CODEX_STATE_DB_WAL_PATH }, "WAL fs.watch failed");
    }
    return null;
  }
}

function installWalWatcher(onChange: () => void, log?: Logger): () => void {
  const direct = tryWatchWal(onChange, log);
  if (direct) return direct;

  let promoted: (() => void) | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  const dir = path.dirname(CODEX_STATE_DB_PATH);
  try {
    dirWatcher = fs.watch(dir, () => {
      if (promoted) return;
      const walCleanup = tryWatchWal(onChange, log);
      if (!walCleanup) return;
      promoted = walCleanup;
      dirWatcher?.close();
      dirWatcher = null;
      onChange();
    });
  } catch (err) {
    log?.debug({ err, dir }, "codex db dir fs.watch failed");
  }
  return () => {
    dirWatcher?.close();
    promoted?.();
  };
}
