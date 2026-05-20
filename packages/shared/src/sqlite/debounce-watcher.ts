/** Generic debounced refresh-watcher backed by an event source (typically
 *  a SQLite WAL `fs.watch` subscription) and a long-lived DB connection.
 *
 *  Codex and OpenCode session-watchers are byte-for-byte the same shape:
 *  hold a DB across the watcher's lifetime, re-read state on every WAL
 *  event (debounced 150 ms), gate dispatch on structural equality, log
 *  install/retire at the watcher boundary. Only the per-event `refresh`
 *  body is integration-specific. The factory captures the shared frame.
 *
 *  Trailing-edge debounce is essential — Linux `fs.watch` fires multiple
 *  events per write, and active-generation bursts are several events per
 *  second. Without coalescing, every burst triggers N refresh passes
 *  (each running SQL queries and JSONL tails) for the same logical state
 *  change. */

import type { Logger } from "../log.ts";

type MaybeClosable = object & { close?: () => void };

export interface DebounceWatcherConfig<
  Session,
  Info,
  Resource extends MaybeClosable,
> {
  /** Identifier for the watched entity, returned via `watcher.session`
   *  unchanged. The factory does not interpret it. */
  session: Session;
  /** Lifecycle log label, e.g. `"codex: session"`. Combined with
   *  `installed`/`retired` to emit `<label> watcher installed/retired`
   *  on subscribe/unsubscribe (see `.agency/code-police.md` →
   *  `watcher-lifecycle-logs`). */
  label: string;
  /** Trailing-edge debounce window in milliseconds. */
  debounceMs: number;
  /** Resource held across the watcher's lifetime. For local callers this
   *  is usually a DB handle; executor-backed callers pass a plain context
   *  object. If it has `close()`, the factory calls it on `destroy()`.
   *  Pass `null` if setup failed — `refresh` will short-circuit. */
  db: Resource | null;
  /** Subscribe to the upstream event source. The factory's debounced
   *  callback fires on every event; the returned unsubscribe runs at
   *  destroy. Errors thrown by listeners surface via the framework's
   *  `onError` and reach the event source's own error path. */
  subscribe: (
    onEvent: () => void,
    onError: (err: unknown) => void,
    log?: Logger,
  ) => () => void;
  /** Compute the current Info from the DB. Return `null` to skip
   *  dispatch (expected-absent state, hard read error logged
   *  internally, integration-specific gating). The factory still calls
   *  `isEqual` separately to avoid no-op `onChange` notifications. */
  refresh: (db: Resource) => Info | null | Promise<Info | null>;
  /** Equality predicate. Only when this returns `false` does the
   *  factory call `onChange`. Pass `agentInfoEqual` from `anyagent`
   *  for the cross-integration shape, or a custom checker. */
  isEqual: (a: Info | null, b: Info) => boolean;
  /** Called with each *changed* Info, after the equality gate. */
  onChange: (info: Info) => void;
  /** Structured fields merged into the watcher's lifecycle log lines
   *  and the `wal listener threw` error path. Typically
   *  `{ session: session.id }` or similar. */
  logCtx: Record<string, unknown>;
  /** Optional structured logger. */
  log?: Logger;
}

export interface DebounceWatcher<Session> {
  readonly session: Session;
  destroy(): void;
}

export function createDebounceWatcher<
  Session,
  Info,
  Resource extends MaybeClosable,
>(
  config: DebounceWatcherConfig<Session, Info, Resource>,
): DebounceWatcher<Session> {
  let destroyed = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let lastInfo: Info | null = null;
  let refreshInFlight = false;
  let refreshPending = false;

  async function performRefresh(): Promise<void> {
    if (destroyed || !config.db) return;
    if (refreshInFlight) {
      refreshPending = true;
      return;
    }
    refreshInFlight = true;
    try {
      const info = await config.refresh(config.db);
      if (destroyed || info === null) return;
      if (config.isEqual(lastInfo, info)) return;
      lastInfo = info;
      config.onChange(info);
    } finally {
      refreshInFlight = false;
      if (refreshPending && !destroyed) {
        refreshPending = false;
        setTimeout(() => void performRefresh(), 0);
      }
    }
  }

  // Trailing-edge debounce: every event resets the timer; one
  // `performRefresh` runs after `debounceMs` of quiet. The handler's
  // own `destroyed` guard makes late-firing callbacks safe, but we
  // clear the timer in `destroy()` anyway to avoid holding closure refs.
  function scheduleRefresh(): void {
    if (destroyed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void performRefresh();
    }, config.debounceMs);
  }

  const unsubscribe = config.subscribe(
    scheduleRefresh,
    (err) => config.log?.error({ err, ...config.logCtx }, "wal listener threw"),
    config.log,
  );
  config.log?.info(config.logCtx, `${config.label} watcher installed`);
  void performRefresh();

  return {
    session: config.session,
    destroy(): void {
      destroyed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      unsubscribe();
      config.db?.close?.();
      config.log?.info(config.logCtx, `${config.label} watcher retired`);
    },
  };
}
