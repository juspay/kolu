import type { Logger } from "@kolu/log";
import fs from "node:fs";
import path from "node:path";
import {
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  type CoalesceSchedule,
} from "./coalesce-schedule.ts";

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

/** WHO ASKED for a watch — an opaque label the caller states (kolu-io knows
 *  nothing about terminals or streams). A string, or a function returning the
 *  current labels: a composed watcher hands its leaf watchers a LIVE view of its
 *  own askers, so a leaf row names whoever is at the top, never the composer. */
export type WatchAsker = string | (() => readonly string[]);

/** Every distinct label across a set of askers right now, in first-seen
 *  order. */
export function distinctAskerLabels(
  askers: Iterable<WatchAsker>,
): readonly string[] {
  const out = new Set<string>();
  for (const asker of askers) {
    for (const label of typeof asker === "string" ? [asker] : asker()) {
      out.add(label);
    }
  }
  return [...out];
}

/** One live dir+filename watch, as a diagnostic row. It covers exactly one
 *  directory: an `fs.watch` on `dir`. */
export interface DirWatcherRow {
  /** The watcher's log label, e.g. `git: head`. */
  readonly kind: string;
  readonly dir: string;
  readonly file: string;
  readonly askers: readonly string[];
  /** From the `watch()` call that created the entry to its `fs.watch` being
   *  live: the directory resolution plus the attach. */
  readonly installMs: number;
}

interface Subscriber {
  readonly onChange: () => void;
  readonly asker: WatchAsker;
}

interface SharedFilenameWatcher {
  subscribe(onChange: () => void, asker: WatchAsker): () => void;
  row(): DirWatcherRow;
  _forceClose(): void;
}

const factories = new Set<{ rows(): DirWatcherRow[] }>();

/** One row per live entry of every dir+filename watcher in this process. */
export function listDirWatcherRows(): DirWatcherRow[] {
  return [...factories].flatMap((f) => f.rows());
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
   *  (`COALESCE_MAX_WAIT_MS`) is always applied internally. */
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
  watch(
    cwd: string,
    asker: WatchAsker,
    onChange: () => void,
    log?: Logger,
  ): () => void;
  /** Test-only inspector — number of distinct resolved dirs with active
   *  shared watchers. Reflects installs that have already settled; pair
   *  with `_whenSettled()` before asserting a count after `watch()`. */
  _watcherCount(): number;
  /** Test-only barrier — resolves once every in-flight `watch()` resolution
   *  has settled (installed or cancelled); tests `await` it before
   *  asserting `_watcherCount()`. */
  _whenSettled(): Promise<void>;
  /** Test-only teardown — close every active watcher and clear the
   *  registry, regardless of subscriber count, and discard any pending
   *  pre-reset resolution instead of installing it into the fresh
   *  registry. */
  _reset(): void;
}

/**
 * Build a `watch(cwd, asker, onChange, log) → unsubscribe` function with a private
 * registry, plus a test-only `_watcherCount()` inspector. Each call to
 * `createDirFilenameWatcher` produces an independent singleton — don't call
 * it twice with the same config and expect sharing.
 */
export function createDirFilenameWatcher(
  config: DirFilenameWatcherConfig,
): DirFilenameWatcher {
  const watchers = new Map<string, SharedFilenameWatcher>();
  const pending = new Set<Promise<void>>();
  let registryEpoch = 0;
  const isStaleResolution = (startEpoch: number): boolean =>
    startEpoch !== registryEpoch;

  function install(
    dir: string,
    watchStartedAt: number,
    onLast: () => void,
    log?: Logger,
  ): SharedFilenameWatcher | null {
    const filePath = path.join(dir, config.filename);
    const listeners = new Set<Subscriber>();
    const coalesce: CoalesceSchedule = createCoalesceSchedule({
      debounceMs: config.debounceMs,
      maxWaitMs: COALESCE_MAX_WAIT_MS,
      onFire: () => {
        const listenersAtFire = [...listeners];
        for (const listener of listenersAtFire) {
          try {
            listener.onChange();
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
    const installMs = performance.now() - watchStartedAt;

    return {
      subscribe(onChange, asker) {
        const listener: Subscriber = { onChange, asker };
        listeners.add(listener);
        return () => {
          if (!listeners.delete(listener)) return;
          if (listeners.size === 0) {
            coalesce.destroy();
            clearTimeout(pollTimer);
            watcher.close();
            onLast();
            log?.info({ dir }, `${config.logLabel} watcher retired`);
          }
        };
      },
      row: () => ({
        kind: config.logLabel,
        dir,
        file: config.filename,
        askers: distinctAskerLabels(
          [...listeners].map((listener) => listener.asker),
        ),
        installMs,
      }),
      _forceClose() {
        listeners.clear();
        coalesce.destroy();
        clearTimeout(pollTimer);
        watcher.close();
      },
    };
  }

  function reconcileAfterInstall(
    onChange: () => void,
    dir: string,
    log?: Logger,
  ): void {
    try {
      onChange();
    } catch (e) {
      log?.error(
        { err: e instanceof Error ? e.message : String(e), dir },
        `${config.logLabel} reconcile listener threw`,
      );
    }
  }

  const factory: DirFilenameWatcher = {
    watch(cwd, asker, onChange, log) {
      const watchStartedAt = performance.now();
      const startEpoch = registryEpoch;
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
        if (cancelled || isStaleResolution(startEpoch) || dir === null) return;
        let entry = watchers.get(dir);
        if (!entry) {
          const fresh = install(
            dir,
            watchStartedAt,
            () => watchers.delete(dir),
            log,
          );
          if (!fresh) return;
          watchers.set(dir, fresh);
          entry = fresh;
        }
        unsubscribe = entry.subscribe(onChange, asker);
        reconcileAfterInstall(onChange, dir, log);
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
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    _reset() {
      registryEpoch++;
      for (const entry of watchers.values()) entry._forceClose();
      watchers.clear();
    },
  };
  factories.add({
    rows: () => [...watchers.values()].map((entry) => entry.row()),
  });
  return factory;
}
