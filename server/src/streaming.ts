/**
 * Streaming helpers for async event-driven endpoints.
 *
 * Reusable for any oRPC streaming handler that bridges an EventEmitter
 * to an AsyncGenerator. Also provides generic async iterable combinators
 * (switchMap, map, prepend) for composing streams.
 */

import type { EventEmitter } from "node:events";

/**
 * Subscribe to an emitter event and yield items as an async iterable.
 *
 * Subscribes BEFORE returning so callers can capture a snapshot between
 * subscription and first yield — any events firing in that gap are queued.
 * Terminates when the AbortSignal fires.
 */
export async function* subscribeAndYield<T = string>(
  emitter: EventEmitter,
  event: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let resolveNext: (() => void) | null = null;

  const listener = (data: T) => {
    queue.push(data);
    resolveNext?.();
  };
  emitter.on(event, listener);

  const cleanup = () => {
    emitter.off(event, listener);
    resolveNext?.();
  };
  signal?.addEventListener("abort", cleanup, { once: true });

  try {
    while (!signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      resolveNext = null;
    }
  } finally {
    cleanup();
    signal?.removeEventListener("abort", cleanup);
  }
}

/**
 * For each value from `source`, start a new inner iterable via `fn` and
 * tear down the previous one. Yields from the active inner only.
 *
 * Modelled after RxJS/IxJS switchMap for async iterables.
 */
export async function* switchMap<T, U>(
  source: AsyncIterable<T>,
  fn: (value: T, signal: AbortSignal) => AsyncIterable<U>,
): AsyncGenerator<U> {
  let innerAc: AbortController | null = null;

  try {
    for await (const outer of source) {
      // Tear down previous inner
      innerAc?.abort();
      innerAc = new AbortController();

      for await (const inner of fn(outer, innerAc.signal)) {
        yield inner;
      }
    }
  } finally {
    innerAc?.abort();
  }
}

/** Yield `value` first, then everything from `source`. */
export async function* prepend<T>(
  source: AsyncIterable<T>,
  value: T,
): AsyncGenerator<T> {
  yield value;
  yield* source;
}

/** Transform each value from `source` through `fn`. */
export async function* map<T, U>(
  source: AsyncIterable<T>,
  fn: (value: T) => U | Promise<U>,
): AsyncGenerator<U> {
  for await (const item of source) {
    yield await fn(item);
  }
}
