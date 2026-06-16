/**
 * Stream adapters the watcher server needs to bridge between three stream
 * shapes: kaval's client tap streams, the DAG's in-memory channels, and the
 * watcher's own served surface streams.
 *
 * All three honour the same teardown contract: an aborted `signal` is EXPECTED
 * (a kill / link drop), never an error — the kaval client streams are opened
 * with `{ signal }`, so an abort ends them cleanly and surfaces here as a
 * swallowed throw, not a failure.
 */

/** Pump a (possibly promised) async-iterable into a callback until it ends or
 *  `signal` aborts. Fire-and-forget: used to feed kaval's taps onto the DAG's
 *  provider channels. `onError` fires only for a NON-abort failure (an abort is
 *  expected teardown). Mirrors kolu-server's `LocalTerminalEndpoint.bridgeStream`. */
export function bridgeStream<T>(
  source: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  onError?: (err: unknown) => void,
): void {
  void (async () => {
    try {
      const iterable = await source;
      for await (const value of iterable) {
        if (signal.aborted) return;
        onEvent(value);
      }
    } catch (err) {
      if (signal.aborted) return;
      onError?.(err);
    }
  })();
}

/** Re-yield a (possibly promised) async-iterable as the watcher's own served
 *  stream, stopping on `signal` abort. Used to FORWARD kaval's pty taps
 *  (terminalAttach/cwd/title/…) straight through the watcher surface, preserving
 *  kaval's snapshot-then-delta framing for the absorbed streams. */
export async function* forwardStream<T>(
  source: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  try {
    const iterable = await source;
    for await (const value of iterable) {
      if (signal.aborted) return;
      yield value;
    }
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }
}

/** Turn a callback-style change subscription (kolu-git's
 *  `subscribeRepoChange`/`subscribeFileChange`) into a served stream that
 *  yields one empty tick per change, coalescing bursts. kolu-server's
 *  `RemoteTerminalEndpoint` re-reads (a forwarded one-shot RPC) on each tick —
 *  so a tick carries no payload, only "something changed, read again". */
export async function* tickStream(
  subscribe: (onChange: () => void) => () => void,
  signal: AbortSignal,
): AsyncGenerator<Record<string, never>> {
  let pending = false;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    pending = true;
    wake?.();
    wake = null;
  };
  const unsubscribe = subscribe(notify);
  signal.addEventListener("abort", notify, { once: true });
  try {
    while (!signal.aborted) {
      if (!pending) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (signal.aborted) return;
      pending = false;
      yield {};
    }
  } finally {
    unsubscribe();
  }
}
