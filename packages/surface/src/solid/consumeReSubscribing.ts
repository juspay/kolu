/**
 * The held-open, RE-SUBSCRIBING consume loop shared by `createSubscription` and
 * `createReactiveSubscription` — the one place the "what to do when a standing
 * surface stream ends" decision lives, so a change to the strategy lands once
 * (the same reason `writeWrappedValue` is shared).
 *
 * A surface stream is meant to be held open (snapshot-then-deltas). It ending
 * WITHOUT an error means the SERVER completed it — e.g. a surface re-serve across
 * a padi drain→respawn rebind (#1681). `ClientRetryPlugin` re-subscribes only on a
 * transport ERROR, never on a clean completion, so without re-opening here a
 * standing subscription would go DEAD: the post-rebind republished snapshot never
 * arrives and the consumer (the Kaval status chip, the Code tab) stays stale until
 * a full page reload. A THROWN error is terminal at this layer — the retry plugin
 * already retried any retriable transport error inside `open()`, so an error
 * reaching here is non-retriable (a dead transport / an application error).
 */

/** Delay before re-subscribing after a clean stream completion. A held-open
 *  surface stream completing is exceptional (a re-serve / teardown), so this only
 *  ever fires on a real rebind — but it bounds the re-subscribe RATE so a server
 *  that pathologically completes its stream in a loop can't spin a republish
 *  storm. Matches the 1s reconnect cadence `STREAM_RETRY` uses for transport
 *  errors (`@kolu/surface/client`). */
const RESUBSCRIBE_DELAY_MS = 1000;

/** A `setTimeout` that also resolves the instant `signal` aborts — so a
 *  subscription torn down mid-delay doesn't leave a dangling timer past its
 *  reactive owner's disposal. Resolves immediately if already aborted. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Consume `open()`'s stream, delivering each item via `onItem`, and RE-SUBSCRIBE
 *  (re-invoke `open()`) after a bounded delay whenever the stream COMPLETES
 *  cleanly — recovering a standing subscription the server ended across a rebind.
 *  A thrown error is reported via `onError` and stops the loop (terminal). Both
 *  callbacks are invoked only while `signal` is un-aborted, so a torn-down
 *  subscription writes nothing. */
export async function consumeReSubscribing<T>(
  open: () => Promise<AsyncIterable<T>>,
  handlers: { onItem: (item: T) => void; onError: (err: unknown) => void },
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const iterable = await open();
      for await (const item of iterable) {
        if (signal.aborted) return;
        handlers.onItem(item);
      }
    } catch (err) {
      if (!signal.aborted) handlers.onError(err);
      return;
    }
    // Clean completion — re-subscribe after a bounded delay (unless torn down).
    await abortableDelay(RESUBSCRIBE_DELAY_MS, signal);
  }
}
