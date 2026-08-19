/**
 * A hand-driven `Stream` for suite use — the one controllable source the deltas
 * tests share.
 *
 * It offers all THREE terminations a real stream has, which is what lets every suite
 * in this package use it instead of a local copy: `push` delivers a frame to a
 * pending `next()` (or queues it), `close` ends the stream normally (a TYPED end),
 * and `fail` rejects it. It mirrors a real wire stream in the one way the tests lean
 * on: an errored iterator never restarts — the consumption loop exits for good once
 * `next()` rejects once.
 *
 * Shared rather than re-hand-rolled per file: four suites drove a stream through
 * near-identical local copies, two of them under this very name in this very
 * directory, which is exactly how they drift apart on the next timing fix.
 */

import { Stream } from "effect";

export interface ControllableStream<T> {
  /** The stream to hand a hook or a subscription. Lazy — nothing runs until pulled. */
  readonly source: Stream.Stream<T, unknown>;
  /** Deliver one frame. */
  push(value: T): void;
  /** End the stream NORMALLY — a typed end, after any frames already queued. */
  close(): void;
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
  let closed = false;

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
          // Queued frames drain BEFORE the end is reported — closing does not
          // discard what was already pushed.
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
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
    close() {
      closed = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.resolve({ value: undefined, done: true });
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
