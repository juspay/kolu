/**
 * SolidJS primitive for consuming async streams as reactive signals.
 *
 * `createLive()` — AsyncIterable → SolidJS signal
 *
 * For mutations, call the server directly (plain RPC). If you need
 * loading/error tracking for a mutation, use SolidJS's `createResource`.
 */

import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

// ---------------------------------------------------------------------------
// createLive — stream to SolidJS signal
// ---------------------------------------------------------------------------

/**
 * A SolidJS Accessor backed by a server stream.
 *
 * Extends `Accessor<T | undefined>` — calling it is a real SolidJS
 * reactive read, just like any signal from `createSignal`. Additional
 * properties for error and pending follow the same pattern as
 * SolidJS's `createResource`.
 */
export interface LiveSignal<T> extends Accessor<T | undefined> {
  /** Stream error (undefined when healthy). */
  readonly error: Accessor<Error | undefined>;
  /** True while waiting for the first event from the stream. */
  readonly pending: Accessor<boolean>;
}

/** Options for createLive. */
export interface LiveOptions<T, R = T> {
  /**
   * Reducer for accumulating stream items.
   * When provided, each item is folded into the accumulator.
   * Without a reducer, each item replaces the previous value.
   */
  reduce?: (accumulator: R, item: T) => R;
  /** Initial value for the accumulator (required when using reduce). */
  initial?: R;
}

/**
 * Convert an async stream into a SolidJS signal.
 *
 * Returns a callable signal — `meta()` reads the value, triggering
 * SolidJS reactivity. Uses `createStore` + `reconcile` under the hood
 * for fine-grained reactivity on nested object fields.
 *
 * ```tsx
 * const meta = createLive(() => client.worker.onMetadataChange({ id }));
 * meta()?.tickCount  // reactive read — re-renders only when tickCount changes
 * meta.pending()     // true until first event
 * meta.error()       // stream error, if any
 * ```
 */
export function createLive<T>(
  source: () => Promise<AsyncIterable<T>>,
): LiveSignal<T>;
export function createLive<T, R>(
  source: () => Promise<AsyncIterable<T>>,
  options: LiveOptions<T, R> & { initial: R },
): LiveSignal<R>;
export function createLive<T, R = T>(
  source: () => Promise<AsyncIterable<T>>,
  options?: LiveOptions<T, R>,
): LiveSignal<T | R> {
  const reduce = options?.reduce as
    | ((acc: T | R, item: T) => T | R)
    | undefined;
  const initial = options?.initial;

  if (reduce && initial === undefined) {
    throw new Error("createLive: 'initial' is required when using 'reduce'");
  }

  // Internal state as a store for fine-grained reactivity on object values.
  // The store wraps the value in { v: T } so reconcile works on any T shape.
  const [store, setStore] = createStore<{ v: T | R | undefined }>({
    v: initial,
  });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);

  // Use reconcile for objects/arrays (fine-grained updates),
  // plain assignment for primitives.
  function updateValue(next: T | R): void {
    if (next !== null && typeof next === "object") {
      setStore(
        "v",
        reconcile(next as Record<string, unknown>) as unknown as
          | T
          | R
          | undefined,
      );
    } else {
      setStore("v", next as T | R);
    }
  }

  function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  // AbortController for cleanup — must register synchronously before any await
  const controller = new AbortController();
  onCleanup(() => controller.abort());

  // Consume the stream
  void (async () => {
    try {
      const iterable = await source();
      for await (const item of iterable) {
        if (controller.signal.aborted) break;
        updateValue(reduce ? reduce(store.v as T | R, item) : item);
        if (pending()) setPending(false);
        if (error()) setError(undefined);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(toError(err));
        if (pending()) setPending(false);
      }
    }
  })();

  return Object.assign(() => store.v as (T | R) | undefined, {
    error,
    pending,
  }) as LiveSignal<T | R>;
}
