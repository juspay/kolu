/**
 * Generic refcounted shared `fs.watch` watcher keyed by directory — the ONE
 * receptacle for "share one non-recursive OS handle per resolved directory".
 *
 * The directory is the watch target, not the file: most editors and tools
 * rewrite files via temp+rename, which destroys an `fs.watch` handle pointed
 * at the original file. A parent-directory watcher catches the rename event
 * cleanly on both Linux inotify and macOS FSEvents.
 *
 * NON-RECURSIVE by design: one handle covers exactly the directory's direct
 * children, so the cost of watching a directory is independent of what's
 * beneath it. That is the property the Code tab's plain-directory browsing
 * stands on: N expanded folders cost N handles, never a recursive crawl of
 * `$HOME`.
 *
 * Refcounted singleton per resolved dir: first subscribe installs, last
 * unsubscribe tears down and drops the registry entry. Idempotent
 * unsubscribe; teardown clears the debounce timer so late callbacks can't
 * fire on a closed watcher.
 *
 * ONE factory, TWO targets, and the difference is a PARAMETER, not an axis:
 * `filename` narrows the same machinery to a single file inside the dir (the
 * git-dir axes: `HEAD`, `index`, `logs/HEAD`, `config`), while omitting it
 * fires on every direct-child event (browsing a plain directory). Everything
 * else — the shared listener set, the coalescer, the async resolve, the
 * post-install reconcile tick, the vanished-directory retirement, and the
 * level-triggered poll below — is identical for both, so both get every
 * lesson exactly once. (A second module cloning this shape is how the
 * error-retirement path and the dropped-edge poll ended up on one copy each.)
 */

import type { Logger } from "@kolu/log";
import fs from "node:fs";
import path from "node:path";
import {
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  type CoalesceSchedule,
} from "./coalesce-schedule.ts";

/** Level-triggered recovery beneath the `fs.watch` fast path. A module
 *  constant, not a caller knob: every watcher built here gets the same
 *  dropped-edge recovery bound. */
export const DIR_WATCH_POLL_MS = 1000;

/** The observation of a path that isn't there. A real state, not a failure —
 *  absent → present is a change the poll must fire on — so it lives in the
 *  same string domain as a digest, and only an UNREADABLE path (a logged
 *  error) is `null`. */
const ABSENT = "\0absent";

/** The poll's baseline for one path: a stat digest, `ABSENT` when it isn't
 *  there, or `null` when it can't be read at all (logged; the caller keeps the
 *  previous baseline rather than treating an unreadable path as a change).
 *
 *  For a DIRECTORY target this is the recovery baseline for the listing axis:
 *  a create / delete / rename of a direct child moves the directory's own
 *  `mtime`, which is exactly what a re-`readdir` would report — at the cost of
 *  one `stat`, not one directory enumeration per second per open level. A
 *  content write to a child file moves neither, so a file's BYTES are not this
 *  axis (they ride the narrow per-file watch: `filename`). */
function statDigest(
  target: string,
  log: Logger | undefined,
  label: string,
): string | null {
  try {
    const stat = fs.statSync(target);
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    log?.error({ err: error, path: target }, `${label} stat failed`);
    return null;
  }
}

interface SharedDirWatcher {
  subscribe(onChange: () => void): () => void;
  /** Test-only: tear down the underlying `fs.watch` handle and clear the poll
   *  and debounce timers, regardless of subscriber count. Invoked by
   *  `DirWatcher._reset()` to break the module-scope leak that
   *  cascades vitest `afterEach` failures (see #955). */
  _forceClose(): void;
}

export interface DirWatcherConfig<K = string> {
  /** Resolve a subscription key → absolute directory to watch, or null to skip
   *  install silently. Called once per `watch()` invocation; the result keys
   *  the registry, so two keys resolving to one directory share a handle.
   *  **Async on purpose** so a resolver that shells out (e.g. `git rev-parse`)
   *  or hits a slow filesystem (a `realpath` traversal guard) never blocks the
   *  event loop — `watch()` kicks the resolution off and attaches `fs.watch`
   *  once it settles, on a later tick. The `log` is passed through for
   *  resolvers that report their own refusals (a path escaping its root). */
  resolveDir: (key: K, log?: Logger) => Promise<string | null>;
  /** Narrow the watch to ONE filename inside the resolved dir — other events
   *  on the directory are ignored, and the poll's baseline is that file's
   *  stat. OMIT to fire on EVERY event for the directory's direct children,
   *  with the DIRECTORY's own stat as the baseline. */
  filename?: string;
  /** Trailing-edge debounce quiet-window in milliseconds. A hard maxWait
   *  (`COALESCE_MAX_WAIT_MS`) is always applied internally — not a
   *  consumer-facing knob (juspay/kolu#1952). */
  debounceMs: number;
  /** Lifecycle log label, e.g. `"git: head"`. Combined with `installed` /
   *  `retired` / `listener threw` for log lines. */
  logLabel: string;
}

export interface DirWatcher<K = string> {
  /** Subscribe to events on the resolved directory (narrowed to `filename`
   *  when the config names one). Returns the unsubscribe **synchronously**;
   *  the underlying `fs.watch` attaches on a later tick once the async
   *  `resolveDir` settles (a no-op if it resolves null). Unsubscribing before
   *  that settles cancels the pending install. Once the handle is live,
   *  `onChange` fires once as a reconciliation tick so a change that landed in
   *  the snapshot→attach window isn't lost (the consumer re-reads and
   *  converges). */
  watch(key: K, onChange: () => void, log?: Logger): () => void;
  /** Test-only inspector — number of distinct resolved dirs with active
   *  shared watchers. Reflects installs that have already settled; pair
   *  with `_whenSettled()` before asserting a count after `watch()`. */
  _watcherCount(): number;
  /** Test-only barrier — resolves once every in-flight `watch()` resolution
   *  has settled (installed or cancelled). The async-install counterpart to
   *  the old synchronous install: tests `await` it before asserting
   *  `_watcherCount()`. */
  _whenSettled(): Promise<void>;
  /** Test-only teardown — close every active watcher and clear the
   *  registry, regardless of subscriber count. Used in vitest `beforeEach`
   *  to break the module-scope leak that turns one timed-out test into a
   *  whole-file cascade (#955). Production code must never call this.
   *  Bumps a generation token so any pending pre-reset resolution is
   *  discarded instead of installing into the fresh registry. */
  _reset(): void;
}

/**
 * Build a `watch(key, onChange, log) → unsubscribe` function with a private
 * registry, plus a test-only `_watcherCount()` inspector. Each call to
 * `createDirWatcher` produces an independent singleton — don't call
 * it twice with the same config and expect sharing.
 */
export function createDirWatcher<K = string>(
  config: DirWatcherConfig<K>,
): DirWatcher<K> {
  const watchers = new Map<string, SharedDirWatcher>();
  // In-flight `watch()` resolutions, so a test can await them settling
  // before asserting `_watcherCount()`. Each entry removes itself on settle.
  const pending = new Set<Promise<void>>();
  // Bumped by `_reset()`. A resolution that started before a reset carries
  // its origin generation; on settle it compares against the live token and
  // discards itself if they differ, so it can't install into a fresh registry.
  let generation = 0;
  const { filename } = config;
  /** What the poll watches: the named file, or the directory itself. */
  const observedPath = (dir: string): string =>
    filename === undefined ? dir : path.join(dir, filename);

  function install(
    dir: string,
    onLast: () => void,
    log?: Logger,
  ): SharedDirWatcher | null {
    const target = observedPath(dir);
    const listeners = new Set<() => void>();
    const dispatch = () => {
      // Snapshot before iteration so a listener that unsubscribes
      // synchronously can't skip a peer for this event.
      for (const cb of [...listeners]) {
        try {
          cb();
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), dir },
            `${config.logLabel} listener threw`,
          );
        }
      }
    };
    // maxWait is baked as COALESCE_MAX_WAIT_MS — no per-call disable (#1952).
    const coalesce: CoalesceSchedule = createCoalesceSchedule({
      debounceMs: config.debounceMs,
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
      clearTimeout(pollTimer);
      watcher.close();
      if (watchers.get(dir) === self) onLast();
    };
    try {
      watcher = fs.watch(dir, (_, eventFilename) => {
        if (filename !== undefined && eventFilename !== filename) return;
        // Refresh the baseline from the edge so the poll below doesn't fire a
        // second, redundant tick for a change the edge already reported.
        const next = statDigest(target, log, config.logLabel);
        if (next !== null) observed = next;
        coalesce.schedule();
      });
    } catch (e) {
      coalesce.destroy();
      // Two different failures, classified off the errno rather than off a
      // caller knob. ENOENT is the expected watch-then-delete race (the user
      // expanded a folder that has since gone): the paired read — a
      // `listDirectory`, a `git status` — surfaces it loudly through the query
      // channel, so the watcher's absence is not a silent degradation and a
      // debug line is the honest level. Anything else (ENOSPC, EMFILE, EPERM)
      // is a real capability failure that leaves the consumer with no live
      // updates and no other reporter, so it is an error.
      const vanished = (e as NodeJS.ErrnoException).code === "ENOENT";
      const fields = { err: e instanceof Error ? e.message : String(e), dir };
      const line = `${config.logLabel} failed to watch dir`;
      if (vanished) log?.debug(fields, line);
      else log?.error(fields, line);
      return null;
    }
    // A watched directory deleted or renamed away emits 'error' (EPERM/ENOENT),
    // and an unhandled `FSWatcher` 'error' event THROWS in Node. Dispatch one
    // last tick SYNCHRONOUSLY (retire destroys the coalesce timer, so a
    // scheduled tick would be lost) so consumers re-read and see the gone state
    // through their own query, then retire the shared handle — a later
    // subscribe for the same path installs fresh. The consumer's re-read is the
    // authority on the gone state, so the watcher never invents an error path.
    watcher.on("error", (e: Error) => {
      log?.debug({ err: e.message, dir }, `${config.logLabel} watch errored`);
      dispatch();
      retire();
    });

    // `fs.watch` is a fast edge, not a delivery guarantee. Capture an
    // authoritative baseline after the handle attaches, then stat on a bounded
    // cadence so a dropped/coalesced edge self-heals. The consumer re-reads and
    // equality-gates the derived state, so an edge/poll double pulse is benign.
    let observed = statDigest(target, log, config.logLabel);
    let pollTimer: NodeJS.Timeout = setTimeout(function poll(): void {
      const next = statDigest(target, log, config.logLabel);
      if (next !== null && next !== observed) {
        observed = next;
        coalesce.schedule();
      }
      pollTimer = setTimeout(poll, DIR_WATCH_POLL_MS);
      pollTimer.unref();
    }, DIR_WATCH_POLL_MS);
    pollTimer.unref();

    log?.info({ dir }, `${config.logLabel} watcher installed`);

    self = {
      subscribe(onChange) {
        listeners.add(onChange);
        return () => {
          // `Set.delete` returns false if `onChange` was already removed —
          // double-call from the same caller can't double-tear-down. A
          // later subscribe under the same dir installs a fresh singleton;
          // this closure stays bound to the old one, so it can't
          // accidentally tear that fresh entry down.
          if (!listeners.delete(onChange)) return;
          if (listeners.size === 0) {
            retire();
            log?.info({ dir }, `${config.logLabel} watcher retired`);
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

  return {
    watch(key, onChange, log) {
      // The resolution (a git subprocess, a realpath traversal guard) must not
      // block the event loop, so it runs async and `fs.watch` attaches once it
      // settles. The unsubscribe is returned synchronously; if it runs
      // before the install settles, `cancelled` short-circuits the install.
      const startGeneration = generation;
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      const settle = (async () => {
        let dir: string | null;
        try {
          dir = await config.resolveDir(key, log);
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), key },
            `${config.logLabel} resolveDir threw`,
          );
          return;
        }
        // Unsubscribed during resolution, or the registry was reset out from
        // under us — drop the install. (No `await` between here and
        // `subscribe()` below, so neither flag can flip mid-install.)
        if (cancelled || startGeneration !== generation || dir === null) return;
        const resolved = dir;
        let entry = watchers.get(resolved);
        if (!entry) {
          const fresh = install(resolved, () => watchers.delete(resolved), log);
          if (!fresh) return;
          watchers.set(resolved, fresh);
          entry = fresh;
        }
        unsubscribe = entry.subscribe(onChange);
        // Post-install reconciliation. The consumer takes its snapshot (a `git
        // status`, a `listDirectory`) and *then* calls `watch()`; this resolve
        // + `fs.watch` attach lands on a LATER tick (an `execFile` git subprocess
        // + a `realpath` ago). A change to the watched target inside that window
        // is in neither the already-sent snapshot nor a future `fs.watch` event,
        // so the consumer would sit on a stale view until the *next* unrelated
        // change. Fire one reconcile tick now that the handle is live so the
        // consumer re-reads and converges. Mirrors `watchWorkingTree`'s own
        // post-install reconciliation (and the @parcel/watcher skill's guidance)
        // — every axis built here needs the same lost-update protection the
        // working-tree axis already has. Wrapped like the event dispatch so a
        // throwing listener can't reject this settle promise (which would
        // surface as an unhandledRejection and, in the server, exit).
        try {
          onChange();
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), dir: resolved },
            `${config.logLabel} reconcile listener threw`,
          );
        }
      })();
      const tracked = settle.finally(() => pending.delete(tracked));
      pending.add(tracked);
      return () => {
        cancelled = true;
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    _watcherCount: () => watchers.size,
    async _whenSettled() {
      // Loop: a settling resolution can, in principle, leave another pending
      // (it can't today — install spawns no watch() — but the barrier stays
      // honest if that changes).
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    _reset() {
      generation++;
      for (const entry of watchers.values()) entry._forceClose();
      watchers.clear();
    },
  };
}
