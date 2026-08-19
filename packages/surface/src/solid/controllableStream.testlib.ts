/**
 * A hand-driven `Stream` for suite use — the one controllable source the deltas
 * tests share.
 *
 * `push` delivers a frame to a pending `next()` (or queues it for the next call);
 * `fail` rejects the next `next()` (or the currently-pending one). It mirrors a real
 * wire stream in the one way the tests lean on: an errored iterator never restarts —
 * the consumption loop exits for good once `next()` rejects once.
 *
 * Shared rather than re-hand-rolled per file: two suites drove the SAME batched
 * `deltas` stream through two near-identical local copies, which is exactly how the
 * two drift apart on the next timing fix.
 */

import { Stream } from "effect";

export interface ControllableStream<T> {
  /** The stream to hand a hook or a subscription. Lazy — nothing runs until pulled. */
  readonly source: Stream.Stream<T, unknown>;
  /** Deliver one frame. */
  push(value: T): void;
  /** Fail the stream once, terminally. */
  fail(error: unknown): void;
}

export function controllableStream<T>(): ControllableStream<T> {
  const queue: T[] = [];
  let waiter: {
    resolve: (r: IteratorResult<T>) => void;
    reject: (e: unknown) => void;
  } | null = null;
  let pendingFailure: { e: unknown } | undefined;

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (pendingFailure) {
            const { e } = pendingFailure;
            pendingFailure = undefined;
            return Promise.reject(e);
          }
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift() as T, done: false });
          }
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiter = { resolve, reject };
          });
        },
      };
    },
  };

  return {
    source: Stream.fromAsyncIterable<T, unknown>(iterable, (e) => e),
    push(value) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.resolve({ value, done: false });
      } else {
        queue.push(value);
      }
    },
    fail(error) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.reject(error);
      } else {
        pendingFailure = { e: error };
      }
    },
  };
}
