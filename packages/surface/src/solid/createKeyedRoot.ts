/**
 * `createKeyedRoot` — run `factory(key)` inside a reactive root that is DISPOSED
 * and rebuilt whenever `key` changes. A pure solid-generic atom: the swap-disposal
 * mechanism a keyed switch (host, connection, entry) leans on, with no knowledge of
 * what it builds.
 *
 * Implemented over `mapArray` as a single-element keyed array. On a key change,
 * `mapArray` builds the incoming key's element under a fresh owner and disposes the
 * PRIOR element's reactive owner — its subscriptions' `onCleanup` fire (a shared
 * dedup slot's ref-count drops → teardown) — within the SAME flush, so no root
 * survives the swap. The eager `createRenderEffect` is load-bearing: its compute
 * PINS the array, so the re-key happens on the flush the key change schedules
 * rather than lazily on the next read. That ordering is what lets the outgoing
 * key's subscriptions abort before any consumer reads the incoming key — so a
 * switch leaks no root across the swap and raises no false error from the outgoing
 * socket's close.
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
      "createKeyedRoot must run under a reactive owner — on the flush a key " +
        "change schedules it disposes the prior key's root (the switch-abort " +
        "ordering) and would leak a detached root otherwise. Call it inside a " +
        "component / createRoot.",
    );
  }
  // Single-element keyed array. mapArray re-runs `factory` on a KEY change (not when
  // an incidental value rebuilds under the same key — the identity-keying), disposing
  // the prior key's owner in the same flush that builds the new one.
  const cells = createMemo(mapArray(() => [key()], factory));
  // Eager pin: the compute reads the array in a render effect so the re-key
  // (build-then-dispose) happens on the key change's own flush, before any consumer
  // read. The effect phase has nothing to do — the pin IS the dependency.
  createRenderEffect(
    () => void cells(),
    () => {},
  );
  return () => cells()[0] as T;
}
