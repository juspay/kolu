/**
 * SolidJS primitives for consuming async streams as reactive signals.
 *
 * Two concepts:
 *  - `createLive()` — AsyncIterable → reactive store (fine-grained via reconcile)
 *  - `createAction()` — async function → [trigger, { pending, value, error }]
 */

import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

// ---------------------------------------------------------------------------
// createLive — stream to reactive state
// ---------------------------------------------------------------------------

/** Return shape of createLive. Callable as accessor (returns T | undefined). */
export interface LiveSignal<T> {
  /** Current value (undefined until first event). */
  readonly value: Accessor<T | undefined>;
  /** Current error (undefined when healthy). */
  readonly error: Accessor<Error | undefined>;
  /** True while waiting for the first event from the stream. */
  readonly pending: Accessor<boolean>;
  /**
   * Optimistic local write. The next server push overwrites this.
   * Optional serverCall fires after the local update.
   */
  readonly mutate: (
    updater: (current: T) => T,
    serverCall?: () => Promise<unknown>,
  ) => void;
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
 * Convert an async stream into a SolidJS reactive signal.
 *
 * Uses `createStore` + `reconcile` under the hood for object values,
 * giving fine-grained reactivity on nested fields.
 *
 * ```tsx
 * // Replacing (default) — each event replaces the value:
 * const meta = createLive(() => client.terminal.onMetadataChange({ id }));
 * // meta.value()?.cwd — only re-renders when cwd changes
 *
 * // Accumulating — events fold into an array:
 * const samples = createLive(
 *   () => client.terminal.onActivityChange({ id }),
 *   { reduce: (acc, item) => [...acc, item].slice(-200), initial: [] },
 * );
 * // samples.value() is ActivitySample[]
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

  return {
    value: () => store.v as (T | R) | undefined,
    error,
    pending,
    mutate(updater: (current: T | R) => T | R, serverCall?) {
      const current = store.v;
      if (current === undefined) return;
      updateValue(updater(current));
      if (serverCall) {
        void serverCall().catch((err) => setError(toError(err)));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// createAction — mutation lifecycle tracking
// ---------------------------------------------------------------------------

/** Return shape for createAction's state signal. */
export interface ActionState<T> {
  /** Result of the last successful call. */
  readonly value: Accessor<T | undefined>;
  /** Error from the last failed call. */
  readonly error: Accessor<Error | undefined>;
  /** True while a call is in flight. */
  readonly pending: Accessor<boolean>;
}

/**
 * Wrap an async function with reactive lifecycle tracking.
 *
 * Returns `[trigger, state]` where `trigger` fires the function and
 * `state` tracks pending/value/error.
 *
 * ```tsx
 * const [create, creating] = createAction(client.terminal.create);
 *
 * // Fire it:
 * const info = await create({ cwd: "/home" });
 *
 * // React to lifecycle:
 * <Show when={creating.pending()}>Creating...</Show>
 * ```
 */
export function createAction<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): [trigger: (...args: Args) => Promise<T>, state: ActionState<T>] {
  const [value, setValue] = createSignal<T | undefined>();
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(false);

  async function trigger(...args: Args): Promise<T> {
    setPending(true);
    setError(undefined);
    try {
      const result = await fn(...args);
      setValue(() => result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(() => e);
      throw e;
    } finally {
      setPending(false);
    }
  }

  return [trigger, { value, error, pending }];
}
