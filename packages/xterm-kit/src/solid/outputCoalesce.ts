export const UNFOCUSED_COALESCE_MS = 100;

export type ScheduleFn = (fn: () => void, ms: number) => number;
export type CancelFn = (id: number) => void;

export interface OutputCoalesceDeps {
  schedule?: ScheduleFn;
  cancel?: CancelFn;
  /** Coalesce window for the non-full-rate path. */
  intervalMs?: number;
}

export interface OutputSink {
  /** Bytes to parse. `onParsed` fires when they reach xterm's buffer. */
  write: (data: string, onParsed?: () => void) => void;
  /** The pty's mirror changed size at this point between two bytes. */
  resize: (cols: number, rows: number) => void;
}

export interface OutputCoalesce {
  /** Buffer-or-passthrough write. `onParsed` fires when the bytes reach xterm. */
  write: (data: string, onParsed?: () => void) => void;
  /** A resize that arrived HERE in the stream. Buffered bytes are flushed
   *  first — they were produced for the OLD grid and must parse at it — and the
   *  resize follows them through the same sink. */
  resize: (cols: number, rows: number) => void;
  /** Flush any pending buffer immediately (call when becoming full-rate). */
  flush: () => void;
  /** Drop pending bytes without writing; keep the handle alive (snapshot reset). */
  clear: () => void;
  /** Drop the timer without writing — only for dispose when the terminal is gone. */
  dispose: () => void;
  /** Test probe: bytes currently waiting for the next flush. */
  pendingBytes: () => number;
}

/**
 * @param isFullRate — true for the one (or few) terminals that must paint live
 *   (focused tile). When this becomes true, call `flush()` from the reactive
 *   owner so a pending unfocused buffer is not left sitting.
 * @param sink — the real write and the real resize (e.g. scroll-lock's pair).
 */
export function createOutputCoalesce(
  isFullRate: () => boolean,
  sink: OutputSink,
  deps: OutputCoalesceDeps = {},
): OutputCoalesce {
  const schedule: ScheduleFn =
    deps.schedule ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const cancel: CancelFn =
    deps.cancel ??
    ((id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
  const intervalMs = deps.intervalMs ?? UNFOCUSED_COALESCE_MS;

  let buf = "";
  let callbacks: (() => void)[] = [];
  let timer: number | null = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function flush(): void {
    clearTimer();
    if (disposed) {
      buf = "";
      callbacks = [];
      return;
    }
    if (buf.length === 0 && callbacks.length === 0) return;
    const data = buf;
    const cbs = callbacks;
    buf = "";
    callbacks = [];
    if (data.length === 0) {
      for (const cb of cbs) cb();
      return;
    }
    sink.write(
      data,
      cbs.length === 0
        ? undefined
        : () => {
            for (const cb of cbs) cb();
          },
    );
  }

  function write(data: string, onParsed?: () => void): void {
    if (disposed) return;
    if (isFullRate()) {
      flush();
      sink.write(data, onParsed);
      return;
    }
    buf += data;
    if (onParsed) callbacks.push(onParsed);
    if (timer === null) {
      timer = schedule(flush, intervalMs);
    }
  }

  function resize(cols: number, rows: number): void {
    if (disposed) return;
    flush();
    sink.resize(cols, rows);
  }

  function clear(): void {
    clearTimer();
    buf = "";
    callbacks = [];
  }

  function dispose(): void {
    disposed = true;
    clear();
  }

  return {
    write,
    resize,
    flush,
    clear,
    dispose,
    pendingBytes: () => buf.length,
  };
}
