/**
 * Generic refcounted shared `fs.watch` watcher keyed by directory.
 *
 * The directory is the watch target, not the file: most editors and tools
 * rewrite files via temp+rename, which destroys an `fs.watch` handle pointed
 * at the original file. A parent-directory watcher catches the rename event
 * cleanly on both Linux inotify and macOS FSEvents.
 *
 * Refcounted singleton per resolved dir: first subscribe installs, last
 * unsubscribe tears down and drops the registry entry. Idempotent
 * unsubscribe; teardown clears the debounce timer so late callbacks can't
 * fire on a closed watcher.
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
 *  constant, not a caller knob: every narrow-file watcher gets the same
 *  dropped-edge recovery bound. */
export const DIR_FILENAME_POLL_MS = 1000;

type FileObservation =
  | { kind: "present"; key: string }
  | { kind: "absent" }
  | { kind: "error" };

function observeFile(
  filePath: string,
  log: Logger | undefined,
  label: string,
): FileObservation {
  try {
    const stat = fs.statSync(filePath);
    return {
      kind: "present",
      key: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent" };
    }
    log?.error({ err: error, path: filePath }, `${label} stat failed`);
    return { kind: "error" };
  }
}

function sameObservation(a: FileObservation, b: FileObservation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "present" && b.kind === "present") return a.key === b.key;
  return true;
}

interface SharedFilenameWatcher {
  subscribe(onChange: () => void): () => void;
  /** Test-only: tear down the underlying `fs.watch` handle and clear the poll
   *  and debounce timers, regardless of subscriber count. Invoked by
   *  `DirFilenameWatcher._reset()` to break the module-scope leak that
   *  cascades vitest `afterEach` failures (see #955). */
  _forceClose(): void;
}

export interface DirFilenameWatcherConfig {
  /** Resolve cwd → absolute directory to watch, or null to skip install
   *  silently. Called once per `watch()` invocation; the result keys the
   *  registry. **Async on purpose** so a resolver that shells out (e.g.
   *  `git rev-parse`) or hits a slow filesystem never blocks the event
   *  loop — `watch()` kicks the resolution off and attaches `fs.watch`
   *  once it settles, on a later tick. */
  resolveDir: (cwd: string) => Promise<string | null>;
  /** Filename inside `resolveDir(cwd)` that fires the listener. Other
   *  events on the directory are ignored. */
  filename: string;
  /** Trailing-edge debounce quiet-window in milliseconds. A hard maxWait
   *  (`COALESCE_MAX_WAIT_MS`) is always applied internally — not a
   *  consumer-facing knob (juspay/kolu#1952). */
  debounceMs: number;
  /** Lifecycle log label, e.g. `"git: head"`. Combined with `installed` /
   *  `retired` / `listener threw` for log lines. */
  logLabel: string;
}

export interface DirFilenameWatcher {
  /** Subscribe to file events on the resolved dir/filename pair. Returns
   *  the unsubscribe **synchronously**; the underlying `fs.watch` attaches
   *  on a later tick once the async `resolveDir` settles (a no-op if it
   *  resolves null). Unsubscribing before that settles cancels the pending
   *  install. Once the handle is live, `onChange` fires once as a
   *  reconciliation tick so a change that landed in the snapshot→attach
   *  window isn't lost (the consumer re-reads and converges). */
  watch(cwd: string, onChange: () => void, log?: Logger): () => void;
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
 * Build a `watch(cwd, onChange, log) → unsubscribe` function with a private
 * registry, plus a test-only `_watcherCount()` inspector. Each call to
 * `createDirFilenameWatcher` produces an independent singleton — don't call
 * it twice with the same config and expect sharing.
 */
export function createDirFilenameWatcher(
  config: DirFilenameWatcherConfig,
): DirFilenameWatcher {
  const watchers = new Map<string, SharedFilenameWatcher>();
  // In-flight `watch()` resolutions, so a test can await them settling
  // before asserting `_watcherCount()`. Each entry removes itself on settle.
  const pending = new Set<Promise<void>>();
  // Bumped by `_reset()`. A resolution that started before a reset carries
  // its origin generation; on settle it compares against the live token and
  // discards itself if they differ, so it can't install into a fresh registry.
  let generation = 0;

  function install(
    dir: string,
    onLast: () => void,
    log?: Logger,
  ): SharedFilenameWatcher | null {
    const filePath = path.join(dir, config.filename);
    const listeners = new Set<() => void>();
    // maxWait is baked as COALESCE_MAX_WAIT_MS — no per-call disable (#1952).
    const coalesce: CoalesceSchedule = createCoalesceSchedule({
      debounceMs: config.debounceMs,
      maxWaitMs: COALESCE_MAX_WAIT_MS,
      onFire: () => {
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
      },
    });

    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, (_, filename) => {
        if (filename !== config.filename) return;
        const next = observeFile(filePath, log, config.logLabel);
        if (next.kind !== "error") observed = next;
        coalesce.schedule();
      });
    } catch (e) {
      coalesce.destroy();
      log?.error(
        { err: e instanceof Error ? e.message : String(e), dir },
        `${config.logLabel} failed to watch dir`,
      );
      return null;
    }

    // `fs.watch` is a fast edge, not a delivery guarantee. Capture an
    // authoritative baseline after the handle attaches, then stat on a bounded
    // cadence so a dropped/coalesced edge self-heals. The consumer re-reads and
    // equality-gates the derived state, so an edge/poll double pulse is benign.
    let observed = observeFile(filePath, log, config.logLabel);
    let pollTimer: NodeJS.Timeout = setTimeout(function poll(): void {
      const next = observeFile(filePath, log, config.logLabel);
      if (next.kind !== "error" && !sameObservation(next, observed)) {
        observed = next;
        coalesce.schedule();
      }
      pollTimer = setTimeout(poll, DIR_FILENAME_POLL_MS);
      pollTimer.unref();
    }, DIR_FILENAME_POLL_MS);
    pollTimer.unref();

    log?.info({ dir }, `${config.logLabel} watcher installed`);

    return {
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
            coalesce.destroy();
            clearTimeout(pollTimer);
            watcher.close();
            onLast();
            log?.info({ dir }, `${config.logLabel} watcher retired`);
          }
        };
      },
      _forceClose() {
        listeners.clear();
        coalesce.destroy();
        clearTimeout(pollTimer);
        watcher.close();
      },
    };
  }

  return {
    watch(cwd, onChange, log) {
      // The resolution (a git subprocess, a realpath) must not block the
      // event loop, so it runs async and `fs.watch` attaches once it
      // settles. The unsubscribe is returned synchronously; if it runs
      // before the install settles, `cancelled` short-circuits the install.
      const startGeneration = generation;
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      const settle = (async () => {
        let dir: string | null;
        try {
          dir = await config.resolveDir(cwd);
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), cwd },
            `${config.logLabel} resolveDir threw`,
          );
          return;
        }
        // Unsubscribed during resolution, or the registry was reset out from
        // under us — drop the install. (No `await` between here and
        // `subscribe()` below, so neither flag can flip mid-install.)
        if (cancelled || startGeneration !== generation || dir === null) return;
        let entry = watchers.get(dir);
        if (!entry) {
          const fresh = install(dir, () => watchers.delete(dir), log);
          if (!fresh) return;
          watchers.set(dir, fresh);
          entry = fresh;
        }
        unsubscribe = entry.subscribe(onChange);
        // Post-install reconciliation. The consumer takes its snapshot (a `git
        // status`, a `resolveGitInfo`) and *then* calls `watch()`; this resolve
        // + `fs.watch` attach lands on a LATER tick (an `execFile` git subprocess
        // + a `realpath` ago). A change to the watched file inside that window is
        // in neither the already-sent snapshot nor a future `fs.watch` event, so
        // the consumer would sit on a stale view until the *next* unrelated
        // change. Fire one reconcile tick now that the handle is live so the
        // consumer re-reads and converges. Mirrors `watchWorkingTree`'s own
        // post-install reconciliation (and the @parcel/watcher skill's guidance)
        // — the git-dir axes (HEAD/reflog/index/config) need the same lost-update
        // protection the working-tree axis already has. Wrapped like the event
        // dispatch so a throwing listener can't reject this settle promise (which
        // would surface as an unhandledRejection and, in the server, exit).
        try {
          onChange();
        } catch (e) {
          log?.error(
            { err: e instanceof Error ? e.message : String(e), dir },
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
