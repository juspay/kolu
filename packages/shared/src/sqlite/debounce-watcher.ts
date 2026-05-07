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
 *  change.
 *
 *  Low-frequency polling fallback — `fs.watch` (inotify on Linux,
 *  FSEvents on darwin) is best-effort: under heavy load the kernel queue
 *  overflows and events are silently dropped. A dropped WAL event would
 *  wedge the watcher in a stale state with no recovery path. The poll
 *  re-runs `refresh` every `pollFallbackMs` (default 2 s); the equality
 *  gate suppresses no-op dispatches, so the cost is one cheap refresh
 *  per interval per active watcher. The poll is suspended while the
 *  debounce timer is armed so a burst can't be amplified. */

import type { Logger } from "../log.ts";
import type { Closable } from "./with-db.ts";

export interface DebounceWatcherConfig<Session, Info, Db extends Closable> {
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
  /** Low-frequency polling fallback — re-run `refresh` every N ms in
   *  addition to event-driven fires. Defends against dropped `fs.watch`
   *  events under inotify queue overflow (parallel test workers, dense
   *  CI runners). Default 2000 ms; pass 0 to disable. */
  pollFallbackMs?: number;
  /** DB handle held across the watcher's lifetime. The factory closes
   *  it on `destroy()`. Pass `null` if `openDb` failed — `refresh` will
   *  short-circuit on every fire and `destroy` is a no-op for the DB. */
  db: Db | null;
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
  refresh: (db: Db) => Info | null;
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

export function createDebounceWatcher<Session, Info, Db extends Closable>(
  config: DebounceWatcherConfig<Session, Info, Db>,
): DebounceWatcher<Session> {
  let destroyed = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let lastInfo: Info | null = null;

  function performRefresh(): void {
    if (destroyed || !config.db) return;
    const info = config.refresh(config.db);
    if (info === null) return;
    if (config.isEqual(lastInfo, info)) return;
    lastInfo = info;
    config.onChange(info);
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
      performRefresh();
    }, config.debounceMs);
  }

  const unsubscribe = config.subscribe(
    scheduleRefresh,
    (err) => config.log?.error({ err, ...config.logCtx }, "wal listener threw"),
    config.log,
  );
  config.log?.info(config.logCtx, `${config.label} watcher installed`);
  performRefresh();

  // Polling fallback. Skipped when a debounce is in flight so a burst of
  // real events can't be amplified into back-to-back refreshes.
  const pollFallbackMs = config.pollFallbackMs ?? 2000;
  const pollTimer =
    pollFallbackMs > 0
      ? setInterval(() => {
          if (destroyed || debounceTimer) return;
          performRefresh();
        }, pollFallbackMs)
      : null;

  return {
    session: config.session,
    destroy(): void {
      destroyed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollTimer) clearInterval(pollTimer);
      unsubscribe();
      config.db?.close();
      config.log?.info(config.logCtx, `${config.label} watcher retired`);
    },
  };
}
