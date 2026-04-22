/**
 * Shared WAL watcher — refcounted singleton for `state_5.sqlite-wal`.
 *
 * Every CodexWatcher wants to react to WAL changes. Rather than have
 * each create its own fs.watch (N sessions = N duplicate watchers + N
 * duplicate dispatches per event), this module refcounts a single
 * watcher: first subscriber lazily installs it, last unsubscribe tears
 * it down.
 *
 * `sharedWalWatcher` is a single nullable structure (not a {watcher,
 * listeners} pair) so the "active iff non-empty" invariant is
 * mechanical — there's no way for the two halves to disagree.
 *
 * Per-listener `onError` is required (not optional) so fault isolation
 * is a type-system obligation, not a convention. If one listener's
 * callback throws, its own onError runs, and iteration continues to
 * the next listener unaffected.
 *
 * Mirrors `subscribeOpenCodeDb` in kolu-opencode and `subscribeSessionsDir`
 * in kolu-claude-code.
 */

import fs from "node:fs";
import path from "node:path";
import { CODEX_STATE_PATH, CODEX_STATE_WAL_PATH } from "./config.ts";
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
    const w = fs.watch(CODEX_STATE_WAL_PATH, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug(
        { err, path: CODEX_STATE_WAL_PATH },
        "codex WAL fs.watch failed",
      );
    }
    return null;
  }
}

/** Install a single fs.watch on state_5.sqlite-wal, falling back to the
 *  parent directory if the WAL doesn't exist yet. When the directory
 *  watcher fires and the WAL file has appeared, promotes itself to a
 *  direct WAL watcher and tears down the directory watcher.
 *
 *  Mirrors `installWalWatcher` in kolu-opencode and `watchOrWaitForDir`
 *  in kolu-claude-code. */
function installWalWatcher(onChange: () => void, log?: Logger): () => void {
  // Try the WAL file directly first
  const direct = tryWatchWal(onChange, log);
  if (direct) return direct;

  // WAL doesn't exist yet — watch the parent directory and promote
  // to the WAL file once it appears.
  let promoted: (() => void) | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  const dir = path.dirname(CODEX_STATE_PATH);
  try {
    dirWatcher = fs.watch(dir, () => {
      if (promoted) return; // already promoted
      const walCleanup = tryWatchWal(onChange, log);
      if (!walCleanup) return; // WAL still absent
      promoted = walCleanup;
      dirWatcher?.close();
      dirWatcher = null;
      // Kick — WAL may already have data written between our first
      // attempt and the directory event.
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
