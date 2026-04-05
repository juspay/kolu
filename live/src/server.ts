/**
 * Server-side primitives for reactive pub/sub channels.
 *
 * Two concepts:
 *  - `createChannel()` — typed pub/sub that produces AsyncIterables
 *  - `liveQuery()` — snapshot-first async generator (subscribe before snapshot)
 */

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/** A typed pub/sub channel. Publish events; subscribers get AsyncIterables. */
export interface Channel<T> {
  /** Send a value to all current subscribers. */
  publish(value: T): void;
  /** Returns an AsyncIterable that yields values published after this call.
   *  Iteration ends when the signal is aborted. */
  subscribe(signal?: AbortSignal): AsyncIterable<T>;
}

/**
 * Create a typed, in-memory pub/sub channel.
 *
 * Each subscriber gets its own queue. Publishing fans out to all active
 * subscribers. When a subscriber's signal is aborted, its queue is removed.
 *
 * ```ts
 * const messages = createChannel<string>();
 * messages.publish("hello");
 *
 * // In a handler:
 * for await (const msg of messages.subscribe(signal)) {
 *   console.log(msg);
 * }
 * ```
 */
export function createChannel<T>(): Channel<T> {
  type Listener = (value: T) => void;
  const listeners = new Set<Listener>();

  return {
    publish(value: T): void {
      for (const listener of listeners) {
        listener(value);
      }
    },

    subscribe(signal?: AbortSignal): AsyncIterable<T> {
      // Eagerly register listener so events are buffered from the moment
      // subscribe() is called — not lazily when for-await starts.
      // This is what makes liveQuery's subscribe-before-snapshot safe.
      const queue: T[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      const listener: Listener = (value) => {
        queue.push(value);
        resolve?.();
        resolve = null;
      };

      listeners.add(listener);

      const cleanup = () => {
        done = true;
        listeners.delete(listener);
        resolve?.();
        resolve = null;
      };

      signal?.addEventListener("abort", cleanup, { once: true });

      const iterator: AsyncIterableIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          while (queue.length === 0) {
            if (done) return { done: true, value: undefined };
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          return { done: false, value: queue.shift()! };
        },

        async return(): Promise<IteratorResult<T>> {
          cleanup();
          return { done: true, value: undefined };
        },

        [Symbol.asyncIterator]() {
          return this;
        },
      };

      return {
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Keyed Channel
// ---------------------------------------------------------------------------

/** A channel multiplexed by key. Each key gets its own independent channel. */
export interface KeyedChannel<K extends string | number, T> {
  /** Publish to a specific key's channel. */
  publish(key: K, value: T): void;
  /** Subscribe to a specific key's channel. */
  subscribe(key: K, signal?: AbortSignal): AsyncIterable<T>;
}

/**
 * Create a keyed channel — a Map of channels indexed by key.
 *
 * Channels are created lazily on first subscribe.
 *
 * ```ts
 * const metadata = createKeyedChannel<string, TerminalMetadata>();
 * metadata.publish(terminalId, { cwd: "/home" });
 *
 * for await (const meta of metadata.subscribe(terminalId, signal)) { ... }
 * ```
 */
export function createKeyedChannel<
  K extends string | number,
  T,
>(): KeyedChannel<K, T> {
  const channels = new Map<K, Channel<T>>();

  function getOrCreate(key: K): Channel<T> {
    let ch = channels.get(key);
    if (!ch) {
      ch = createChannel<T>();
      channels.set(key, ch);
    }
    return ch;
  }

  return {
    publish(key: K, value: T): void {
      // Only publish if channel exists (has had subscribers)
      channels.get(key)?.publish(value);
    },

    subscribe(key: K, signal?: AbortSignal): AsyncIterable<T> {
      return getOrCreate(key).subscribe(signal);
    },
  };
}

// ---------------------------------------------------------------------------
// Live Query
// ---------------------------------------------------------------------------

/**
 * Create a snapshot-first async generator from a channel.
 *
 * The critical ordering: subscribe first, then compute the snapshot.
 * Any events published between subscribe and snapshot are queued in the
 * channel's per-subscriber buffer, guaranteeing no data loss.
 *
 * ```ts
 * // In a router handler:
 * yield* liveQuery(
 *   (signal) => metadata.subscribe(id, signal),
 *   () => getCurrentMetadata(id),
 * )(signal);
 * ```
 */
export function liveQuery<T>(
  subscribe: (signal?: AbortSignal) => AsyncIterable<T>,
  snapshot: () => T | Promise<T>,
): (signal?: AbortSignal) => AsyncGenerator<T> {
  return async function* (signal?: AbortSignal): AsyncGenerator<T> {
    // Subscribe FIRST — any publishes between here and the yield are queued
    const live = subscribe(signal);
    // Then compute and yield the snapshot
    yield await snapshot();
    // Then yield live events
    for await (const value of live) {
      yield value;
    }
  };
}

/**
 * Variant of liveQuery where the snapshot yields multiple items.
 *
 * Used when the snapshot is a history (e.g., activity samples) where each
 * item is yielded individually rather than as a single array.
 *
 * ```ts
 * yield* liveQueryMany(
 *   (signal) => activity.subscribe(id, signal),
 *   () => getActivityHistory(id),
 * )(signal);
 * ```
 */
export function liveQueryMany<T>(
  subscribe: (signal?: AbortSignal) => AsyncIterable<T>,
  snapshot: () => Iterable<T> | Promise<Iterable<T>>,
): (signal?: AbortSignal) => AsyncGenerator<T> {
  return async function* (signal?: AbortSignal): AsyncGenerator<T> {
    const live = subscribe(signal);
    for (const item of await snapshot()) {
      yield item;
    }
    for await (const value of live) {
      yield value;
    }
  };
}
