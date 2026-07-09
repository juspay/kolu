/**
 * `createKeyedRoot` — run `factory(key)` inside a reactive root that is DISPOSED
 * and rebuilt whenever `key` changes. A pure solid-generic atom: the swap-disposal
 * mechanism a keyed switch (host, connection, entry) leans on, with no knowledge of
 * what it builds.
 *
 * Implemented over `mapArray` as a single-element keyed array. On a key change,
 * `mapArray` disposes the PRIOR element's reactive owner — its subscriptions'
 * `onCleanup` fire (a shared dedup slot's ref-count drops → teardown) — BEFORE it
 * builds the new element under a fresh owner. The eager `createRenderEffect` is
 * load-bearing: it PINS the array so that disposal happens SYNCHRONOUSLY on the key
 * change, not lazily on the next read. That ordering is what lets the outgoing key's
 * subscriptions abort before anything reads the incoming key — so a switch leaks no
 * root across the swap and raises no false error from the outgoing socket's close.
 */

import {
  type Accessor,
  createMemo,
  createRenderEffect,
  getOwner,
  mapArray,
} from "solid-js";

export function createKeyedRoot<K, T>(
  key: Accessor<K>,
  factory: (key: K) => T,
): Accessor<T> {
  if (!getOwner()) {
    throw new Error(
      "createKeyedRoot must run under a reactive owner — it disposes the prior " +
        "key's root synchronously on a key change (the switch-abort ordering) and " +
        "would leak a detached root otherwise. Call it inside a component / createRoot.",
    );
  }
  // Single-element keyed array. mapArray re-runs `factory` on a KEY change (not when
  // an incidental value rebuilds under the same key — the identity-keying), disposing
  // the prior key's owner first.
  const cells = createMemo(mapArray(() => [key()], factory));
  // Eager pin: read the array in a render effect so the re-key (dispose-then-build)
  // happens synchronously on the key change, before any consumer read.
  createRenderEffect(() => void cells());
  return () => cells()[0] as T;
}
