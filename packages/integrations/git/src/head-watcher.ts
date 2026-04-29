/**
 * Refcounted shared `.git/HEAD` watcher.
 *
 * N terminals open in the same git repo collapse to one `fs.watch` handle
 * and one debounce timer that fans out to all listeners. First subscriber
 * installs; last unsubscribe tears down and drops the registry entry, so
 * a fresh subscribe after teardown installs a new watcher cleanly.
 *
 * Mirrors the refcounted-singleton pattern in
 * `packages/integrations/anyagent/src/wal-subscription.ts` — different
 * sharing strategy (module-scope `Map` keyed by gitDir vs factory-private
 * closure) for a different lifetime: WAL subscriptions are scoped to one
 * integration instance; HEAD watchers are scoped to a system-wide path.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "anyagent";

const DEBOUNCE_MS = 150;

/** External surface of one shared watcher: a `subscribe` method that adds a
 *  listener and returns its own unsubscribe. The listener Set, watcher
 *  handle, and debounce timer are all closure-private — registry lifecycle
 *  and dispatch policy can evolve independently because callers can only
 *  reach what `subscribe` exposes. */
interface SharedHeadWatcher {
  subscribe(onChange: () => void): () => void;
}

/** Module-scope registry: one entry per resolved gitDir. */
const sharedHeadWatchers = new Map<string, SharedHeadWatcher>();

function installSharedHeadWatcher(
  gitDir: string,
  onLast: () => void,
  log?: Logger,
): SharedHeadWatcher | null {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(gitDir, (_, filename) => {
      if (filename !== "HEAD") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        // Snapshot before iteration so a listener that unsubscribes
        // synchronously can't skip a peer for this event.
        for (const cb of [...listeners]) {
          try {
            cb();
          } catch (e) {
            log?.debug(
              { err: e instanceof Error ? e.message : String(e), gitDir },
              "git: head listener threw",
            );
          }
        }
      }, DEBOUNCE_MS);
    });
  } catch (e) {
    log?.debug(
      { err: e instanceof Error ? e.message : String(e), gitDir },
      "git: failed to watch git dir",
    );
    return null;
  }

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        // `Set.delete` returns false if `onChange` was already removed,
        // which keeps the unsubscribe idempotent: a double-call from the
        // same caller can't double-tear-down. A later subscribe under the
        // same gitDir installs a fresh singleton; this closure stays bound
        // to the old one, so it can't accidentally tear that fresh entry
        // down.
        if (!listeners.delete(onChange)) return;
        if (listeners.size === 0) {
          if (timer) clearTimeout(timer);
          watcher.close();
          onLast();
        }
      };
    },
  };
}

/**
 * Watch .git/HEAD for changes (branch switches, checkout, etc.).
 * Returns a cleanup function. Returns a no-op for non-git directories.
 *
 * N callers watching the same `gitDir` share a single `fs.watch` handle
 * and a single debounce timer. Cost per HEAD event is O(listeners)
 * regardless of how many terminals subscribed.
 */
export function watchGitHead(
  cwd: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  let gitDir: string;
  try {
    const result = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitDir = path.resolve(cwd, result.trim());
  } catch {
    // Expected in non-git directories — watchGitHead is called speculatively.
    return () => {};
  }

  let entry = sharedHeadWatchers.get(gitDir);
  if (!entry) {
    const fresh = installSharedHeadWatcher(
      gitDir,
      () => sharedHeadWatchers.delete(gitDir),
      log,
    );
    if (!fresh) return () => {};
    sharedHeadWatchers.set(gitDir, fresh);
    entry = fresh;
  }
  return entry.subscribe(onChange);
}

/** Test-only inspector — number of distinct gitDirs with active shared
 *  watchers. Used by unit tests to assert the singleton invariant without
 *  spying on `fs.watch`. */
export function _sharedHeadWatcherCount(): number {
  return sharedHeadWatchers.size;
}
