/**
 * `useCollection` — Solid hook bridging a server collection to per-key
 * reactive accessors.
 *
 * The collection itself has two streams:
 *  - `keys` — the live set of keys (driven by adds and deletes)
 *  - `byKey(k)` — the live value for a single key
 *
 * Per-key subscriptions are managed via `mapArray` so SolidJS handles the
 * lifecycle: when a key leaves the live set, its reactive owner is
 * disposed, the per-key subscription's `onCleanup` fires, the AbortController
 * aborts, and the server stream tears down. No manual Map / version
 * signals / abort plumbing required at the call site.
 */

import { type Accessor, createMemo, mapArray } from "solid-js";
import { createRoot } from "solid-js";
import type { Collection } from "../index";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";

export interface UseCollectionOptions<K, T> {
  /** Source factory for the live key set. */
  keysSource: () => Promise<AsyncIterable<K[]>>;
  /** Source factory for one key's value stream. */
  valueSource: (key: K) => Promise<AsyncIterable<T>>;
  /** Called when any subscription errors. */
  onError?: SubscriptionOptions<unknown>["onError"];
}

export interface UseCollectionResult<K, T> {
  /** Reactive accessor for the current key set. */
  keys: Accessor<K[]>;
  /** Reactive accessor for the value at `key`, or `undefined` if not yet
   *  yielded. The per-key subscription is created lazily and disposed
   *  when the key leaves the set. */
  byKey: (key: K) => Subscription<T> | undefined;
  /** True until the keys subscription has yielded its first snapshot. */
  pending: Accessor<boolean>;
  /** Last keys-subscription error. Per-key errors surface via the
   *  individual `byKey(k).error()` accessor. */
  error: Accessor<Error | undefined>;
  /** The underlying keys subscription — for advanced consumers. */
  keysSub: Subscription<K[]>;
}

export function useCollection<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  options: UseCollectionOptions<K, T>,
): UseCollectionResult<K, T> {
  const keysSub = createRoot(() =>
    createSubscription(options.keysSource, {
      onError: options.onError,
    }),
  );

  const keys = createMemo<K[]>(() => keysSub() ?? []);

  // mapArray creates a reactive owner per key. When a key leaves, its
  // owner is disposed → the per-key sub's onCleanup → AbortController abort
  // → server stream closes. No manual teardown.
  const perKey = mapArray(keys, (key) => {
    const sub = createSubscription(() => options.valueSource(key), {
      onError: options.onError,
    });
    return { key, sub };
  });

  function byKey(key: K): Subscription<T> | undefined {
    return perKey().find((p) => p.key === key)?.sub;
  }

  return {
    keys,
    byKey,
    pending: keysSub.pending,
    error: keysSub.error,
    keysSub,
  };
}
