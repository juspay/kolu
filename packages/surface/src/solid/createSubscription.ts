/**
 * SolidJS primitive for consuming async streams as reactive signals.
 *
 * `createSubscription()` — AsyncIterable → SolidJS Accessor
 *
 * For mutations, call the server directly (plain RPC). If you need
 * loading/error tracking for a mutation, use SolidJS's `createResource`.
 */

import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { writeWrappedValue } from "./writeValue";

/**
 * A SolidJS Accessor backed by a server stream.
 *
 * Extends `Accessor<T | undefined>` — calling it is a real SolidJS
 * reactive read, just like any signal from `createSignal`. Additional
 * properties for error and pending follow the same pattern as
 * SolidJS's `createResource`.
 */
export interface Subscription<T> extends Accessor<T | undefined> {
  /** Stream error (undefined when healthy). */
  readonly error: Accessor<Error | undefined>;
  /** True while waiting for the first event from the stream. */
  readonly pending: Accessor<boolean>;
  /** True once the stream has ENDED NORMALLY (a typed end — never on abort).
   *  Latches permanently: once true, this subscription's value is FROZEN —
   *  it will never update again. Without this fact, an ended subscription
   *  reads byte-identical to a healthy, currently-streaming one (no error, not
   *  pending), so a consumer that holds onto a `Subscription` across a typed
   *  end (e.g. one sharing slot behind the keyed cache, evicted for LATER
   *  callers but still referenced by an earlier one) has no way to tell its
   *  last-read value is stale-forever rather than current. Check this before
   *  trusting `value()` as "live".
   *
   *  Optional (not every `Subscription`-shaped value is minted by
   *  `createSubscription`/`createReactiveSubscription` — a hand-assembled one
   *  built directly over `{ pending, error }`, predating this fact, has no
   *  typed-end concept to report and legitimately omits it); every subscription
   *  built through THIS module's factories always populates it. */
  readonly complete?: Accessor<boolean>;
}

/** Options for createSubscription. */
export interface SubscriptionOptions<T, R = T> {
  /**
   * Reducer for accumulating stream items.
   * When provided, each item is folded into the accumulator.
   * Without a reducer, each item replaces the previous value.
   */
  reduce?: (accumulator: R, item: T) => R;
  /** Initial value for the accumulator (required when using reduce). */
  initial?: R;
  /**
   * External abort signal for imperative lifecycle management.
   * When provided, used instead of `onCleanup` — allows creating
   * subscriptions outside a reactive owner (e.g. dynamic per-entity maps).
   */
  signal?: AbortSignal;
  /** Called when the stream errors. Use to surface failures to the user
   *  (e.g. `toast.error`). Without this, stream errors are only available
   *  via the reactive `sub.error()` signal — easy to forget to read. */
  onError?: (err: Error) => void;
  /** Called when the stream ENDS NORMALLY — the async iterable completed because
   *  the server/map sent a typed end — NEVER on abort. The keyed subscription cache
   *  wires this to evict a shared slot on typed completion, so a re-added member
   *  never reuses an ended stream. "A disposed subscription cannot report anything"
   *  extends here: an aborted subscription must not fire `onComplete`. */
  onComplete?: () => void;
}

/** Convert an async stream into a SolidJS signal. `source` receives the
 *  subscription's OWN abort signal (the external `options.signal` when supplied,
 *  else the internal `AbortController` this call creates) — thread it into the
 *  underlying procedure call (`unenrolledStreamCall(proc, input, { signal })` /
 *  a `StreamingProcedure`'s `{ signal }` opt) so disposing the subscription
 *  actually cancels the wire stream, not just the local consume loop. Without
 *  this, teardown only stops READING the stream — the server-side subscription
 *  (and its bounded frame queue) stays open until the stream happens to end on
 *  its own, or forever for a quiet cell/collection that never publishes again.
 *  A `source` that ignores the signal (a test double, an in-memory iterable
 *  with nothing to cancel) is unaffected — the loop's own `abortSignal.aborted`
 *  check still stops consumption either way. */
export function createSubscription<T>(
  source: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
): Subscription<T>;
export function createSubscription<T>(
  source: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  options: Omit<SubscriptionOptions<T>, "reduce" | "initial">,
): Subscription<T>;
export function createSubscription<T, R>(
  source: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  options: SubscriptionOptions<T, R> & { initial: R },
): Subscription<R>;
export function createSubscription<T, R = T>(
  source: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  options?: SubscriptionOptions<T, R>,
): Subscription<T | R> {
  const reduce = options?.reduce as
    | ((acc: T | R, item: T) => T | R)
    | undefined;
  const initial = options?.initial;

  if (reduce && initial === undefined) {
    throw new Error(
      "createSubscription: 'initial' is required when using 'reduce'",
    );
  }

  // Internal state as a store for fine-grained reactivity on object values.
  // The store wraps the value in { v: T } so reconcile works on any T shape.
  const [store, setStore] = createStore<{ v: T | R | undefined }>({
    v: initial,
  });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);

  function updateValue(next: T | R): void {
    writeWrappedValue(setStore, next as T | R | undefined);
  }

  function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  // Single cleanup path: external signal OR internal AbortController + onCleanup.
  // Never both — avoids dual lifecycle braiding.
  const abortSignal =
    options?.signal ??
    (() => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      return controller.signal;
    })();

  // Consume the stream
  void (async () => {
    try {
      const iterable = await source(abortSignal);
      for await (const item of iterable) {
        if (abortSignal.aborted) break;
        updateValue(reduce ? reduce(store.v as T | R, item) : item);
        if (pending()) setPending(false);
        if (error()) setError(undefined);
      }
      // Normal completion — the iterable ended because the server/map sent a TYPED
      // end (not an abort: an aborted loop takes the `break` above and its
      // `abortSignal.aborted` is already true here). Clear any lingering `pending`
      // and signal the typed end so the dedup cache can evict this slot. An aborted
      // (disposed) subscription reports nothing.
      if (!abortSignal.aborted) {
        if (pending()) setPending(false);
        setComplete(true);
        options?.onComplete?.();
      }
    } catch (err) {
      if (!abortSignal.aborted) {
        setError(toError(err));
        if (pending()) setPending(false);
      }
    }
  })();

  const sub = Object.assign(() => store.v as (T | R) | undefined, {
    error,
    pending,
    complete,
  }) as Subscription<T | R>;

  if (options?.onError) {
    wireSubscriptionError(sub, options.onError);
  }

  return sub;
}

/** Wire a per-consumer error handler onto a subscription's self-clearing `error()`
 *  signal, via an EDGE effect — fires once per rising error transition and clears
 *  with the signal (never the inline-in-catch double-fire, and never latching a
 *  transient blip the signal already cleared). Factored out of `createSubscription`
 *  so the keyed subscription cache can share ONE upstream subscription across N
 *  consumers while each consumer still gets its OWN `onError` (a per-call label /
 *  toast), wired under that consumer's own reactive owner.
 *
 *  Takes only `{ error }` (not the whole `Subscription<T>`) — the one field this
 *  reads — so a shared, ALREADY-DESTRUCTURED result (e.g. a read-only `liveWhen`
 *  cell's standing view) can wire through it too, instead of every call site
 *  re-hand-rolling the same edge-effect (which drifts: a hand-rolled version tends
 *  to run the callback TRACKED, re-subscribing the effect to whatever the handler
 *  itself reads, where this helper's `on()` runs it untracked). */
export function wireSubscriptionError(
  sub: { error: Accessor<Error | undefined> },
  onError: (err: Error) => void,
): void {
  createEffect(
    on(
      () => sub.error(),
      (err) => {
        if (err) onError(err);
      },
    ),
  );
}
