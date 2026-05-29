/**
 * Bounded, eager-subscribe broadcast channel — the fan-out primitive a
 * `PtyHost` uses to hand one PTY's output (and its OSC-derived metadata)
 * to many independent consumers.
 *
 * Two properties earn this its own type rather than a plain
 * `EventEmitter` or an `AsyncIterable` generator:
 *
 *   1. **Eager subscribe.** `subscribe()` registers the receiver into the
 *      subscriber set SYNCHRONOUSLY, before the returned iterable is ever
 *      pulled. This is what makes `PtyHost.attach()` race-free: it can do
 *      `subscribe()` then `serialize()` as two back-to-back synchronous
 *      statements, and — because the PTY publishes only from the headless
 *      parse callback (a later task) — no chunk can slip between the two.
 *      Every byte lands in exactly one of snapshot / deltas.
 *
 *   2. **Drop-slow-subscriber.** Each subscriber buffers independently up
 *      to `maxQueue` items. A consumer that stops draining (a wedged
 *      browser tab on a chatty `data` stream) is DROPPED — its iterator
 *      ends — rather than growing the buffer without bound and pinning
 *      server memory. The client's transparent re-subscribe then delivers
 *      a fresh snapshot. Bounded memory beats unbounded fidelity here.
 */

/** Sentinel pushed to a subscriber to end its iterator (close or abort). */
const CLOSE = Symbol("pty-host-channel-close");

/** Shared already-finished iterable for closed/aborted subscriptions. */
const EMPTY: AsyncIterable<never> = {
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.resolve({ done: true, value: undefined }),
  }),
};

/** Default per-subscriber buffered-item cap before drop-slow kicks in. */
const DEFAULT_MAX_QUEUE = 10_000;

export interface ChannelOptions {
  /** Per-subscriber buffered-item cap. A subscriber whose queue exceeds
   *  this is dropped (its iterator ends) rather than buffering forever.
   *  Defaults to 10,000. */
  maxQueue?: number;
  /** Invoked when a subscriber is dropped for exceeding `maxQueue`. */
  onOverflow?: () => void;
}

interface Sub<T> {
  push: (value: T | typeof CLOSE) => void;
}

export class Channel<T> {
  private readonly subs = new Set<Sub<T>>();
  private closed = false;
  private readonly maxQueue: number;
  private readonly onOverflow?: () => void;

  constructor(options: ChannelOptions = {}) {
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.onOverflow = options.onOverflow;
  }

  /** Synchronous fire-and-forget broadcast to every live subscriber. */
  publish(value: T): void {
    if (this.closed) return;
    for (const sub of this.subs) sub.push(value);
  }

  /** Close the channel — every in-flight iterator ends gracefully. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sub of this.subs) sub.push(CLOSE);
    this.subs.clear();
  }

  /** Whether this channel has any live subscribers — diagnostics only. */
  get subscriberCount(): number {
    return this.subs.size;
  }

  /**
   * Register a subscriber eagerly and return its async-iterable view.
   *
   * The subscriber is added to the set the moment `subscribe()` is
   * called — not on first `next()` — so a `publish()` that races a
   * `subscribe()`/`serialize()` pair is captured deterministically.
   */
  subscribe(signal?: AbortSignal): AsyncIterable<T> {
    if (this.closed || signal?.aborted) return EMPTY;

    const queue: (T | typeof CLOSE)[] = [];
    let resolveNext: ((result: IteratorResult<T>) => void) | null = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      this.subs.delete(sub);
      signal?.removeEventListener("abort", onAbort);
    };

    const sub: Sub<T> = {
      push: (value) => {
        if (finished) return;
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          if (value === CLOSE) {
            finished = true;
            resolve({ done: true, value: undefined });
          } else {
            resolve({ done: false, value });
          }
          return;
        }
        if (value !== CLOSE && queue.length >= this.maxQueue) {
          // Slow subscriber: drop it instead of buffering without bound.
          this.subs.delete(sub);
          this.onOverflow?.();
          queue.length = 0;
          queue.push(CLOSE);
          return;
        }
        queue.push(value);
      },
    };
    this.subs.add(sub);

    const onAbort = () => sub.push(CLOSE);
    signal?.addEventListener("abort", onAbort, { once: true });

    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<T>> => {
          if (queue.length > 0) {
            const head = queue.shift() as T | typeof CLOSE;
            if (head === CLOSE) {
              cleanup();
              return Promise.resolve({ done: true, value: undefined });
            }
            return Promise.resolve({ done: false, value: head });
          }
          if (finished) {
            cleanup();
            return Promise.resolve({ done: true, value: undefined });
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            resolveNext = resolve;
          });
        },
        return: (): Promise<IteratorResult<T>> => {
          cleanup();
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    };
  }
}
