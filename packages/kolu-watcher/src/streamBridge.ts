/**
 * Stream adapters the watcher server needs to bridge between two of its stream
 * shapes: the watcher's own served surface streams (`forwardStream`) and the
 * change-tick streams it re-serves from kolu-git (`tickStream`). The tap-pump
 * primitive that feeds kaval's taps onto the DAG's provider channels
 * (`bridgeStream`, carrying the per-event fence) is shared with kolu-server via
 * `@kolu/terminal-dag` — both hosts run the same provider DAG, so one copy.
 *
 * Both honour the same teardown contract: an aborted `signal` is EXPECTED
 * (a kill / link drop), never an error — the kaval client streams are opened
 * with `{ signal }`, so an abort ends them cleanly and surfaces here as a
 * swallowed throw, not a failure.
 */

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
