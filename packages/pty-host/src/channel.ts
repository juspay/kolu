/**
 * Minimal multi-subscriber channel used inside `@kolu/pty-host` to fan
 * out PTY data + metadata events to N attached clients. Each subscribe
 * call gets its own AsyncIterable backed by a bounded queue; slow
 * consumers block fast producers via the queue's back-pressure window
 * (events drop into the queue and the iterator pulls them at its own
 * pace). The package keeps this internal so it doesn't drag a
 * dependency on `@kolu/surface`'s inMemoryChannel through every
 * downstream consumer.
 */
export class Channel<T> {
  private readonly subs = new Set<(value: T) => void>();
  private closed = false;

  publish(value: T): void {
    if (this.closed) return;
    for (const sub of this.subs) sub(value);
  }

  /** Close the channel — all in-flight iterators end gracefully. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sub of this.subs) sub(CLOSE_SENTINEL as never);
    this.subs.clear();
  }

  subscribe(signal?: AbortSignal): AsyncIterable<T> {
    return subscribeChannel(this.subs, this.closed, signal);
  }
}

const CLOSE_SENTINEL = Symbol("channel-close");

async function* subscribeChannel<T>(
  subs: Set<(value: T) => void>,
  alreadyClosed: boolean,
  signal: AbortSignal | undefined,
): AsyncIterable<T> {
  if (alreadyClosed) return;
  const queue: T[] = [];
  let resolveNext: ((v: IteratorResult<T>) => void) | null = null;
  let done = false;

  const push = (value: T | typeof CLOSE_SENTINEL): void => {
    if (done) return;
    if (value === CLOSE_SENTINEL) {
      done = true;
      resolveNext?.({ value: undefined, done: true });
      resolveNext = null;
      return;
    }
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: value as T, done: false });
    } else {
      queue.push(value as T);
    }
  };

  subs.add(push as (value: T) => void);
  const onAbort = (): void => {
    done = true;
    subs.delete(push as (value: T) => void);
    resolveNext?.({ value: undefined, done: true });
    resolveNext = null;
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    while (!done) {
      if (queue.length > 0) {
        yield queue.shift() as T;
        continue;
      }
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        resolveNext = resolve;
      });
      if (next.done) return;
      yield next.value;
    }
  } finally {
    subs.delete(push as (value: T) => void);
    signal?.removeEventListener("abort", onAbort);
  }
}
