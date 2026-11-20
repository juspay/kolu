import fs from "node:fs";
import type { Logger } from "@kolu/log";

/** Poll interval (ms) for the floor that every production call site passes. A
 *  module constant, never a per-call knob (`conventions.md`: "being able to
 *  override is never a feature") — the recovery latency this buys is uniform
 *  across providers. Tests inject a shorter real interval (never fake timers —
 *  a fake clock cannot drive the real `statSync`). */
export const DEFAULT_APPEND_POLL_MS = 1000;

export interface SubscribeFileAppendsOpts {
  /** Poll interval in milliseconds for the level-triggered floor. **Required**
   *  — not optional-with-default (that shape is the dead knob the fail-fast law
   *  forbids). Production passes `DEFAULT_APPEND_POLL_MS`; tests inject a short
   *  real interval, exactly as `createDirFilenameWatcher` takes `debounceMs`. */
  intervalMs: number;
  log?: Logger;
  /** Lifecycle log label for error lines, e.g. `"grok: events"`. **Required**
   *  — not optional-with-default, mirroring `intervalMs`: an optional-with-default
   *  is the dead knob the fail-fast law forbids. All call sites pass it. */
  label: string;
}

type Observation =
  | { kind: "present"; key: string }
  | { kind: "absent" }
  | { kind: "error" };

function observe(
  filePath: string,
  log: Logger | undefined,
  tag: string,
): Observation {
  try {
    const s = fs.statSync(filePath);
    return { kind: "present", key: `${s.size}:${s.mtimeMs}:${s.ino}` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { kind: "absent" };
    log?.error({ err, path: filePath }, `${tag}: stat failed`);
    return { kind: "error" };
  }
}

function sameState(a: Observation, b: Observation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "present" && b.kind === "present") return a.key === b.key;
  return true;
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
 * watcher behind a `closed` guard, so no late callback fires on a torn-down
 * watcher. A throwing `onChange` is caught and logged, never escaping the
 * watcher callback to crash the host.
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

  let observed = observe(filePath, log, label);
  let pollTimer: NodeJS.Timeout = setTimeout(function poll(): void {
    if (closed) return;
    const cur = observe(filePath, log, label);
    if (cur.kind !== "error" && !sameState(cur, observed)) {
      observed = cur;
      emit();
    }
    // Recheck AFTER emit: a reentrant `unsubscribe()` from inside onChange sets
    // `closed`, and this running tick must not re-arm the timer past it (F7).
    if (closed) return;
    pollTimer = setTimeout(poll, intervalMs);
    pollTimer.unref();
  }, intervalMs);
  pollTimer.unref();

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
    clearTimeout(pollTimer);
    watcher?.close();
  };
}
