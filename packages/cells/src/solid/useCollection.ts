/**
 * `useCollection` — Solid hook for per-key reactive subscriptions over a
 * keyed server collection.
 *
 * The hook takes a reactive `keys` accessor — caller-provided so the keys
 * source can be anything (a server stream wrapped in createSubscription,
 * a derivation from a list-of-records subscription, a static array). Per-key
 * subscriptions are managed via `mapArray` so SolidJS handles the lifecycle:
 * when a key leaves the set, its reactive owner is disposed, the per-key
 * subscription's `onCleanup` fires, the AbortController aborts, and the
 * server stream tears down. No manual Map / version signals / abort plumbing
 * required at the call site.
 *
 * `valueSource` is a typed oRPC procedure ref (e.g.
 * `client.terminal.onMetadataChange`) plus a `keyToInput` adapter — the
 * input shape per key varies by procedure (some take `{ id }`, some take
 * `{ key }`, some take the raw key) and the framework can't guess. The
 * hook threads `STREAM_RETRY` context internally.
 */

import { type Accessor, createMemo, mapArray } from "solid-js";
import { STREAM_RETRY, type StreamingProcedure } from "../client";
import type { Collection } from "../index";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";

export interface UseCollectionOptions<K, T, I = K> {
  /** Reactive accessor for the live key set. The caller owns the subscription
   *  (or computation) that produces this — useCollection just observes it. */
  keys: Accessor<K[]>;
  /** Typed streaming procedure ref for one key's value stream. Hook
   *  threads `STREAM_RETRY` context per call. */
  valueSource: StreamingProcedure<I, T>;
  /** Adapter from key to procedure input shape. Required when input
   *  isn't the key itself (the common case — most procedures take
   *  `{ id: key }` or similar). */
  keyToInput?: (key: K) => I;
  /** Called when any per-key subscription errors. */
  onError?: SubscriptionOptions<unknown>["onError"];
}

export interface UseCollectionResult<K, T> {
  /** Reactive accessor for the current key set (passes through `options.keys`). */
  keys: Accessor<K[]>;
  /** Reactive accessor for the value at `key`, or `undefined` if not yet
   *  yielded. The per-key subscription is created lazily and disposed
   *  when the key leaves the set. */
  byKey: (key: K) => Subscription<T> | undefined;
}

export function useCollection<Name extends string, K, T, I = K>(
  _coll: Collection<Name, K, T>,
  options: UseCollectionOptions<K, T, I>,
): UseCollectionResult<K, T> {
  const keys = createMemo<K[]>(() => options.keys());
  const toInput = options.keyToInput ?? ((k: K) => k as unknown as I);

  // mapArray creates a reactive owner per key. When a key leaves, its
  // owner is disposed → the per-key sub's onCleanup → AbortController abort
  // → server stream closes. No manual teardown.
  const perKey = mapArray(keys, (key) => {
    const sub = createSubscription(
      () => options.valueSource(toInput(key), { context: STREAM_RETRY }),
      { onError: options.onError },
    );
    return { key, sub };
  });

  function byKey(key: K): Subscription<T> | undefined {
    return perKey().find((p) => p.key === key)?.sub;
  }

  return { keys, byKey };
}
