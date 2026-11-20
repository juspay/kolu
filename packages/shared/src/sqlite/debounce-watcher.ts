import {
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  type CoalesceSchedule,
} from "kolu-io";
import type { Logger } from "../log.ts";
import type { Closable } from "./with-db.ts";

export interface DebounceWatcherConfig<Session, Info, Db extends Closable> {
  /** Identifier for the watched entity, returned via `watcher.session`
   *  unchanged. The factory does not interpret it. */
  session: Session;
  /** Lifecycle log label, e.g. `"codex: session"`. Combined with
   *  `installed`/`retired` to emit `<label> watcher installed/retired`
   *  on subscribe/unsubscribe (the `watcher-lifecycle-logs` rule). */
  label: string;
  /** Trailing-edge debounce quiet-window in milliseconds. maxWait is
   *  always `COALESCE_MAX_WAIT_MS` internally (#1952). */
  debounceMs: number;
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
  let lastInfo: Info | null = null;

  function performRefresh(): void {
    if (destroyed || !config.db) return;
    const info = config.refresh(config.db);
    if (info === null) return;
    if (config.isEqual(lastInfo, info)) return;
    lastInfo = info;
    config.onChange(info);
  }

  const coalesce: CoalesceSchedule = createCoalesceSchedule({
    debounceMs: config.debounceMs,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: performRefresh,
  });

  const unsubscribe = config.subscribe(
    () => {
      if (destroyed) return;
      coalesce.schedule();
    },
    (err) => config.log?.error({ err, ...config.logCtx }, "wal listener threw"),
    config.log,
  );
  config.log?.info(config.logCtx, `${config.label} watcher installed`);
  performRefresh();

  return {
    session: config.session,
    destroy(): void {
      destroyed = true;
      coalesce.destroy();
      unsubscribe();
      config.db?.close();
      config.log?.info(config.logCtx, `${config.label} watcher retired`);
    },
  };
}
