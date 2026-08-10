/**
 * Refcounted shared non-recursive directory watcher — the "what's inside this
 * one folder" counterpart to `refcounted-dir-watcher.ts` (which narrows to a
 * single filename inside the dir). One `fs.watch` handle per distinct
 * directory, shared by every subscriber, torn down when the last leaves.
 *
 * NON-RECURSIVE by design: one watch handle covers exactly the directory's
 * direct children (create/delete/rename, and — on both Linux inotify and macOS
 * FSEvents — content writes to direct-child files). It never descends, so the
 * cost of watching a directory is independent of what's beneath it. That is
 * the property the Code tab's plain-directory browsing stands on: N expanded
 * folders cost N handles, never a recursive crawl of `$HOME`.
 *
 * A directory that disappears mid-watch fires one last tick and retires the
 * shared handle: the consumer's re-read is the authority on the gone state (it
 * surfaces the error through the query channel), so the watcher never has to
 * invent an error path of its own. Same reasoning at install time: a vanished
 * dir logs at debug and installs nothing — the paired listing read reports the
 * failure loudly.
 */

import fs from "node:fs";
import type { Logger } from "@kolu/log";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
} from "./coalesce-schedule.ts";

interface SharedDirWatcher {
  subscribe(onChange: () => void): () => void;
  /** Test-only: close the handle and clear timers regardless of subscriber
   *  count (see `refcounted-dir-watcher.ts`'s `_forceClose` — same #955
   *  vitest-cascade reasoning). */
  _forceClose(): void;
}

const watchers = new Map<string, SharedDirWatcher>();

function install(dir: string, log?: Logger): SharedDirWatcher | null {
  const listeners = new Set<() => void>();
  const dispatch = () => {
    // Snapshot before iteration so a listener that unsubscribes synchronously
    // can't skip a peer for this event.
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (e) {
        log?.error(
          { err: e instanceof Error ? e.message : String(e), dir },
          "dir-children listener threw",
        );
      }
    }
  };
  const coalesce = createCoalesceSchedule({
    debounceMs: COALESCE_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: dispatch,
  });

  let watcher: fs.FSWatcher;
  let retired = false;
  // Registry removal is identity-guarded (`watchers.get(dir) === self`): a
  // retire racing a successor install for the same path must not delete the
  // successor's entry.
  let self: SharedDirWatcher | null = null;
  const retire = () => {
    if (retired) return;
    retired = true;
    coalesce.destroy();
    watcher.close();
    if (watchers.get(dir) === self) watchers.delete(dir);
  };
  try {
    watcher = fs.watch(dir, () => coalesce.schedule());
  } catch (e) {
    coalesce.destroy();
    // Install-time ENOENT is the expected expand-then-delete race; the paired
    // directory listing surfaces it loudly through the query channel, so the
    // watcher's absence is not a silent degradation — debug, not error.
    log?.debug(
      { err: e instanceof Error ? e.message : String(e), dir },
      "dir-children watch install failed",
    );
    return null;
  }
  // A watched directory deleted or renamed away emits 'error' (EPERM/ENOENT).
  // Dispatch one last tick SYNCHRONOUSLY (retire destroys the coalesce timer,
  // so a scheduled tick would be lost) so consumers re-read and see the gone
  // state through their own query, then retire the shared handle — a later
  // subscribe for the same path installs fresh.
  watcher.on("error", (e: Error) => {
    log?.debug({ err: e.message, dir }, "dir-children watch errored");
    dispatch();
    retire();
  });

  log?.debug({ dir }, "dir-children watcher installed");

  self = {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        // Idempotent — a double-call can't double-tear-down, and a closure
        // bound to a retired singleton can't tear down its replacement.
        if (!listeners.delete(onChange)) return;
        if (listeners.size === 0) {
          retire();
          log?.debug({ dir }, "dir-children watcher retired");
        }
      };
    },
    _forceClose() {
      listeners.clear();
      retire();
    },
  };
  return self;
}

/** Subscribe to change ticks for ONE directory's direct children (debounced,
 *  refcounted, non-recursive). `dir` must be an absolute path the caller has
 *  already validated — this primitive does no traversal guarding of its own.
 *  Returns the unsubscribe. A directory that can't be watched (already gone)
 *  yields a subscription that simply never fires — the caller's paired read is
 *  the authority that reports the failure. */
export function subscribeDirChildren(
  dir: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  let entry = watchers.get(dir);
  if (!entry) {
    const fresh = install(dir, log);
    if (!fresh) return () => {};
    watchers.set(dir, fresh);
    entry = fresh;
  }
  return entry.subscribe(onChange);
}

/** Test-only: number of live shared watchers. */
export function _dirChildrenWatcherCount(): number {
  return watchers.size;
}

/** Test-only teardown — close every watcher regardless of subscriber count
 *  (vitest `beforeEach`, the #955 cascade guard). */
export function _resetDirChildrenWatchers(): void {
  for (const entry of [...watchers.values()]) entry._forceClose();
  watchers.clear();
}
