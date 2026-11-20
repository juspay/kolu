import fs from "node:fs";
import type { Logger } from "@kolu/log";

/** Poll interval (ms) for the floor that every production call site passes.
 *  Tests inject a shorter real interval. */
export const DEFAULT_APPEND_POLL_MS = 1000;

export interface SubscribeFileAppendsOpts {
  /** Poll interval in milliseconds for the level-triggered floor. Production
   *  passes `DEFAULT_APPEND_POLL_MS`. */
  intervalMs: number;
  log?: Logger;
  /** Lifecycle log label for error lines, e.g. `"grok: events"`. */
  label: string;
}

type AuthoritativeState = { kind: "present"; key: string } | { kind: "absent" };

type UnreadableStat = null;

function observe(
  filePath: string,
  log: Logger | undefined,
  tag: string,
): AuthoritativeState | UnreadableStat {
  try {
    const s = fs.statSync(filePath);
    return { kind: "present", key: `${s.size}:${s.mtimeMs}:${s.ino}` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { kind: "absent" };
    log?.error({ err, path: filePath }, `${tag}: stat failed`);
    return null;
  }
}

function sameState(a: AuthoritativeState, b: AuthoritativeState): boolean {
  if (a.kind === "present") return b.kind === "present" && a.key === b.key;
  return b.kind === "absent";
}

function levelTriggeredFloor(
  filePath: string,
  emit: () => void,
  intervalMs: number,
  log: Logger | undefined,
  label: string,
): () => void {
  let stopped = false;
  let observed: AuthoritativeState | UnreadableStat = observe(
    filePath,
    log,
    label,
  );
  let timer: NodeJS.Timeout | undefined;

  const arm = (): void => {
    if (stopped) return;
    timer = setTimeout(tick, intervalMs);
    timer.unref();
  };

  function tick(): void {
    const current = observe(filePath, log, label);
    if (current !== null) {
      if (observed === null || !sameState(current, observed)) {
        observed = current;
        emit();
      }
    }
    arm();
  }

  arm();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * Watch `filePath` for content changes with an append-robust guarantee, and
 * call `onChange` (the consumer's own debounced, change-gated handler) whenever
 * it may have changed. Subscribe **unconditionally** — the file need not exist
 * yet; the poll tolerates absence and fires `onChange` on the **absent→present
 * transition** (a session file that appears after attach) and on every
 * subsequent append.
 *
 * **The consumer must perform its own initial read on attach** for immediate
 * state — the primitive emits no *synchronous* on-attach `onChange`; the poll's
 * synchronously-captured baseline means the FIRST post-attach change is what
 * fires, at most one interval later. So: consumer reads now, the floor recovers
 * anything the edge drops thereafter.
 *
 * Returns an idempotent unsubscribe that cancels the poll and closes the edge
 * watcher; no callback fires after it. A throwing `onChange` is caught and
 * logged, never escaping the watcher callback to crash the host.
 */
export function subscribeFileAppends(
  filePath: string,
  onChange: () => void,
  opts: SubscribeFileAppendsOpts,
): () => void {
  const { intervalMs, log, label } = opts;
  let closed = false;

  const emit = (): void => {
    if (closed) return;
    try {
      onChange();
    } catch (err) {
      log?.error({ err, path: filePath }, `${label}: onChange threw`);
    }
  };

  const stopFloor = levelTriggeredFloor(filePath, emit, intervalMs, log, label);

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(filePath, emit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: filePath }, `${label}: fs.watch failed`);
    }
  }

  return () => {
    if (closed) return;
    closed = true;
    stopFloor();
    watcher?.close();
  };
}
