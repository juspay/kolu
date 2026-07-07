/**
 * `createKeyedSubscriptionCache` — per-client ref-counted subscription dedup.
 *
 * A surface client builds ONE of these (in `buildSurfaceClient`). Every static-input
 * `.use()` on the client (a cell, a whole-collection subscription) routes its
 * construction through `use(cacheKey, make, enroll)`, so N views of the same
 * `(proc, static-input)` share ONE upstream subscription instead of opening N. This
 * replaces the "sharing by convention" idiom (module-const `createSharedRoot`
 * singletons) with sharing built into the base client — every consumer inherits it,
 * and the shared subscription tears down when the LAST consumer leaves (unlike a
 * `createSharedRoot`, which never tears down).
 *
 * Each slot is `@solid-primitives/rootless`'s `createSingletonRoot` — the audited
 * ecosystem primitive whose semantics are exactly "created once, ref-counted per
 * reactive listener, disposed (in a microtask) when the last leaves." The microtask
 * defer is load-bearing: a switch-away-and-back within a tick reuses the still-warm
 * root instead of tearing down and rebuilding.
 *
 * LIFETIME CONTRACT (the invariant the map's membership leans on):
 *   1. The shared root is owned by the CLIENT (the `clientOwner` passed explicitly),
 *      NEVER by whichever consumer happened to subscribe first — a first-consumer
 *      owner is the leak class this cache exists to kill.
 *   2. A slot is evicted from the map on the LAST-listener disposal (the root's
 *      `onCleanup`) AND on a TYPED completion (`make`'s `onTypedEnd`, fired only on
 *      a normal stream end — never on abort). So a re-added member never reuses an
 *      ended slot, and "a live cached sub for an absent member" is unrepresentable
 *      (paired with the map layer's absent-at-subscribe short-circuit, which never
 *      reaches this cache).
 *   3. `enroll` runs ONCE inside the shared slot (health() counts a shared slot once,
 *      not once per consumer) and un-enrolls on slot disposal (it rides the slot
 *      owner's cleanup). Per-consumer `onError` is NOT wired here — the caller wires
 *      it on the returned shared value under its own owner (`wireSubscriptionError`).
 */

import { createSingletonRoot } from "@solid-primitives/rootless";
import { type Owner, onCleanup } from "solid-js";

export interface KeyedSubscriptionCache {
  /**
   * Get-or-create the ONE shared value for `cacheKey`, ref-counted per reactive
   * listener. `make` builds it, receiving `onTypedEnd` to wire into the underlying
   * subscription's `onComplete` (evict-on-typed-end). `enroll`, when given, runs
   * ONCE inside the shared slot with the shared value. Returns the shared value; the
   * CALLER wires per-consumer `onError` on it under its own owner.
   */
  use<R>(
    cacheKey: string,
    make: (onTypedEnd: () => void) => R,
    enroll?: (shared: R) => void,
  ): R;
}

export function createKeyedSubscriptionCache(
  clientOwner: Owner | null,
): KeyedSubscriptionCache {
  const slots = new Map<string, () => unknown>();

  function use<R>(
    cacheKey: string,
    make: (onTypedEnd: () => void) => R,
    enroll?: (shared: R) => void,
  ): R {
    const existing = slots.get(cacheKey);
    if (existing) return existing() as R;

    // Evict this slot from the map. Guarded on identity so a slot rebuilt after a
    // prior eviction (last-listener or typed end) can never be clobbered by a stale
    // eviction from the previous generation. Referenced by both the last-listener
    // `onCleanup` and the typed-end callback below; `slot` is assigned before either
    // can fire (the factory runs on the first `slot()` call, after this `const`).
    const evict = (): void => {
      if (slots.get(cacheKey) === slot) slots.delete(cacheKey);
    };

    const slot = createSingletonRoot<R>(() => {
      // (1) Evict on LAST-listener disposal: createSingletonRoot disposes this root
      //     (in a microtask) once the last reactive listener leaves; `onCleanup`
      //     then drops the map entry so a later subscribe rebuilds a fresh slot.
      onCleanup(evict);
      // (2) Build the shared value; `onTypedEnd = evict` fires on a NORMAL stream end
      //     (typed completion) — never on abort — so a re-added member never reuses
      //     an ended slot.
      const shared = make(evict);
      // (3) Enroll ONCE inside the shared slot (un-enrolls on slot disposal), so N
      //     consumers of this slot count once in health(), not N times.
      enroll?.(shared);
      return shared;
    }, clientOwner);

    slots.set(cacheKey, slot as () => unknown);
    return slot();
  }

  return { use };
}
