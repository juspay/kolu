/**
 * Shared WAL watcher — refcounted singleton for `state_5.sqlite-wal`.
 *
 * Every CodexWatcher wants to react to WAL changes. Rather than have
 * each create its own fs.watch (N sessions = N duplicate watchers + N
 * duplicate dispatches per event), this module refcounts a single
 * watcher: first subscriber lazily installs it, last unsubscribe tears
 * it down.
 *
 * Mirrors `subscribeOpenCodeDb` in kolu-opencode — same invariants,
 * same fault-isolation contract, same parent-dir fallback for the
 * pre-first-write window.
 */

import fs from "node:fs";
import path from "node:path";
import { CODEX_DB_PATH, CODEX_DB_WAL_PATH } from "./config.ts";
import type { Logger } from "anyagent";

interface WalListener {
  cb: () => void;
  onError: (err: unknown) => void;
}

let sharedWalWatcher: {
  cleanup: () => void;
  listeners: Set<WalListener>;
} | null = null;

/**
 * Subscribe to changes in Codex's SQLite WAL file. Returns an
 * unsubscribe function. The underlying `fs.watch` is shared across all
 * subscribers — refcounted, installed on first subscribe, torn down on
 * last unsubscribe.
 *
 * `onError` receives any exception thrown by `onChange` and runs in
 * place of breaking the iteration over peer listeners. Callers must
 * provide one (silent swallowing would hide bugs) — pass a logger call
 * like `(err) => log.warn({ err }, "...")`.
 */
export function subscribeCodexDb(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  if (!sharedWalWatcher) {
    const listeners = new Set<WalListener>();
    const cleanup = installWalWatcher(() => {
      // Snapshot before iteration so a listener that subscribes or
      // unsubscribes synchronously can't skip a peer for this event.
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

/** Try to attach an fs.watch directly to the WAL file. Returns the
 *  watcher's cleanup function, or null if the file doesn't exist yet. */
function tryWatchWal(onChange: () => void, log?: Logger): (() => void) | null {
  try {
    const w = fs.watch(CODEX_DB_WAL_PATH, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Non-ENOENT (EACCES, EMFILE, etc.) is a real failure — state
      // detection is broken for every Codex session until resolved —
      // not an expected-absent condition. Log at error so operators
      // see it without having to filter debug noise.
      log?.error({ err, path: CODEX_DB_WAL_PATH }, "WAL fs.watch failed");
    }
    return null;
  }
}

/** Install a single fs.watch on state_5.sqlite-wal, falling back to the
 *  parent directory if the WAL doesn't exist yet. When the directory
 *  watcher fires and the WAL file has appeared, promotes itself to a
 *  direct WAL watcher and tears down the directory watcher.
 *
 *  Mirrors `installWalWatcher` in kolu-opencode. */
function installWalWatcher(onChange: () => void, log?: Logger): () => void {
  const direct = tryWatchWal(onChange, log);
  if (direct) return direct;

  let promoted: (() => void) | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  const dir = path.dirname(CODEX_DB_PATH);
  try {
    dirWatcher = fs.watch(dir, () => {
      if (promoted) return;
      const walCleanup = tryWatchWal(onChange, log);
      if (!walCleanup) return;
      promoted = walCleanup;
      dirWatcher?.close();
      dirWatcher = null;
      // Kick — WAL may already have data written between our first
      // attempt and the directory event.
      onChange();
    });
  } catch (err) {
    // Same rationale as tryWatchWal: a watch failure on the parent
    // directory means we can never promote to a direct WAL watcher,
    // so every future Codex state update is silently lost. Error-level.
    log?.error({ err, dir }, "codex db dir fs.watch failed");
  }
  return () => {
    dirWatcher?.close();
    promoted?.();
  };
}
