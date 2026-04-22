import fs from "node:fs";
import path from "node:path";
import { codexStateWalPath } from "./config.ts";
import type { Logger } from "anyagent";

interface WalListener {
  cb: () => void;
  onError: (err: unknown) => void;
}

type SharedWalWatcher = {
  cleanup: () => void;
  listeners: Set<WalListener>;
};

const sharedWalWatchers = new Map<string, SharedWalWatcher>();

export function subscribeCodexDb(
  dbPath: string,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  let shared = sharedWalWatchers.get(dbPath);
  if (!shared) {
    const listeners = new Set<WalListener>();
    shared = {
      listeners,
      cleanup: installWalWatcher(
        dbPath,
        () => {
          for (const listener of [...listeners]) {
            try {
              listener.cb();
            } catch (err) {
              listener.onError(err);
            }
          }
        },
        log,
      ),
    };
    sharedWalWatchers.set(dbPath, shared);
  }

  const listener: WalListener = { cb: onChange, onError };
  shared.listeners.add(listener);
  return () => {
    const active = sharedWalWatchers.get(dbPath);
    if (!active) return;
    active.listeners.delete(listener);
    if (active.listeners.size === 0) {
      active.cleanup();
      sharedWalWatchers.delete(dbPath);
    }
  };
}

function tryWatchWal(
  dbPath: string,
  onChange: () => void,
  log?: Logger,
): (() => void) | null {
  const walPath = codexStateWalPath(dbPath);
  try {
    const watcher = fs.watch(walPath, () => onChange());
    return () => watcher.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug({ err, path: walPath }, "codex wal fs.watch failed");
    }
    return null;
  }
}

function installWalWatcher(
  dbPath: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  const direct = tryWatchWal(dbPath, onChange, log);
  if (direct) return direct;

  let promoted: (() => void) | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  const dir = path.dirname(dbPath);
  try {
    dirWatcher = fs.watch(dir, () => {
      if (promoted) return;
      const attached = tryWatchWal(dbPath, onChange, log);
      if (!attached) return;
      promoted = attached;
      dirWatcher?.close();
      dirWatcher = null;
      onChange();
    });
  } catch (err) {
    log?.debug({ err, dir }, "codex state dir fs.watch failed");
  }

  return () => {
    dirWatcher?.close();
    promoted?.();
  };
}
