/**
 * Server-side primitives for end-to-end reactive streams.
 *
 * Two concepts:
 *  - `live(fn)` — reactive expression → AsyncGenerator (for state)
 *  - `events()` — push/iterate pair (for discrete events)
 *
 * State is modeled with signals from @solidjs/signals. `live()` bridges
 * the signal graph to AsyncIterable — the universal streaming interface
 * that oRPC (or any transport) can carry to the client.
 */

import { createRoot, createEffect, flush } from "@solidjs/signals";

// ---------------------------------------------------------------------------
// Internal: async queue — shared mechanics for toStream and events
// ---------------------------------------------------------------------------

/** Push/pull queue bridging synchronous pushes to async iteration. */
interface AsyncQueue<T> {
  push: (value: T) => void;
  done: () => void;
  iterable: AsyncIterable<T>;
}

function createAsyncQueue<T>(abortSignal?: AbortSignal): AsyncQueue<T> {
  const buffer: T[] = [];
  let resolve: (() => void) | null = null;
  let finished = false;

  const done = () => {
    if (finished) return;
    finished = true;
    resolve?.();
    resolve = null;
  };

  abortSignal?.addEventListener("abort", done, { once: true });

  const iterator: AsyncIterableIterator<T> = {
    async next(): Promise<IteratorResult<T>> {
      while (buffer.length === 0) {
        if (finished) return { done: true, value: undefined };
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
      return { done: false, value: buffer.shift()! };
    },

    async return(): Promise<IteratorResult<T>> {
      done();
      return { done: true, value: undefined };
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return {
    push(value: T) {
      buffer.push(value);
      resolve?.();
      resolve = null;
    },
    done,
    iterable: { [Symbol.asyncIterator]: () => iterator },
  };
}

// ---------------------------------------------------------------------------
// Internal: watch — reactive expression → callback
// ---------------------------------------------------------------------------

/**
 * Watch a reactive expression and call `cb` with each new value.
 * Returns a dispose function that tears down the reactive root.
 *
 * The first evaluation fires synchronously after `flush()`.
 */
function watch<T>(fn: () => T, cb: (value: T) => void): () => void {
  return createRoot((dispose) => {
    createEffect(
      () => fn(),
      (value) => cb(value),
    );
    return dispose;
  });
}

// ---------------------------------------------------------------------------
// live — reactive expression → AsyncGenerator
// ---------------------------------------------------------------------------

/**
 * Bridge a reactive expression to an AsyncGenerator.
 *
 * Tracks all signal reads inside `fn`. When any tracked signal changes,
 * re-evaluates `fn` and yields the new value. The first evaluation is
 * the snapshot — yielded immediately.
 *
 * `fn` must read signals/memos that outlive the subscription — i.e.,
 * signals created at module scope or in a parent root that won't be
 * disposed while clients are connected.
 *
 * ```ts
 * import { createSignal } from "@solidjs/signals";
 * import { live } from "solid-live/server";
 *
 * const [count, setCount] = createSignal(0);
 * setInterval(() => setCount(c => c + 1), 1000);
 *
 * // In a router handler:
 * yield* live(() => count())(signal);
 * ```
 */
export function live<T>(
  fn: () => T,
): (signal?: AbortSignal) => AsyncGenerator<T> {
  return (abortSignal?: AbortSignal) => {
    const queue = createAsyncQueue<T>(abortSignal);
    const dispose = watch(fn, queue.push);

    // Tear down the reactive root when the stream ends
    abortSignal?.addEventListener(
      "abort",
      () => {
        dispose();
        queue.done();
      },
      { once: true },
    );

    // Flush the reactive runtime so the initial effect fires and the
    // snapshot value is queued before the first yield.
    flush();

    // Return as AsyncGenerator (iterable + .next()/.return())
    const iter = queue.iterable[Symbol.asyncIterator]();
    return iter as AsyncGenerator<T>;
  };
}

// ---------------------------------------------------------------------------
// events — push/iterate pair for discrete events
// ---------------------------------------------------------------------------

/**
 * Create a push/iterate pair for discrete events (not state).
 *
 * Use for things that happen (activity samples, log lines, exit codes)
 * as opposed to things that are (metadata, status, preferences).
 *
 * ```ts
 * const [pushActivity, iterateActivity] = events<ActivitySample>();
 *
 * // Push from domain logic:
 * pushActivity([Date.now(), true]);
 *
 * // In a router handler:
 * for await (const sample of iterateActivity(signal)) yield sample;
 * ```
 */
export function events<T>(): [
  push: (value: T) => void,
  iterate: (signal?: AbortSignal) => AsyncIterable<T>,
] {
  type Listener = (value: T) => void;
  const listeners = new Set<Listener>();

  function push(value: T): void {
    for (const listener of listeners) {
      listener(value);
    }
  }

  function iterate(abortSignal?: AbortSignal): AsyncIterable<T> {
    // Eagerly register listener so events are buffered from the moment
    // iterate() is called — not lazily when for-await starts.
    const queue = createAsyncQueue<T>(abortSignal);

    listeners.add(queue.push);

    abortSignal?.addEventListener("abort", () => listeners.delete(queue.push), {
      once: true,
    });

    return queue.iterable;
  }

  return [push, iterate];
}
