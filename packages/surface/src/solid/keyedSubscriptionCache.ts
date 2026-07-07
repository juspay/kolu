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

// A module-private registry giving each distinct FUNCTION a stable short id, so a
// function-valued option (applyPatch / mergeIntoStore / source / mutate) contributes a
// STABLE token to the cache key by IDENTITY — the same function → the same token, a
// different function → a different one (never source text, which two closures share).
const fnIds = new WeakMap<object, number>();
let fnCounter = 0;
function fnId(fn: object): number {
  let id = fnIds.get(fn);
  if (id === undefined) {
    id = ++fnCounter;
    fnIds.set(fn, id);
  }
  return id;
}

/** Whether a data value serializes through `JSON.stringify` INJECTIVELY — i.e. two
 *  distinct values can't collide to one string. `JSON.stringify` is lossy for `Set`/`Map`
 *  (both → `"{}"` regardless of contents), for nested `undefined`/`function`/`symbol`
 *  values (silently dropped), for non-plain objects (`Date`/`RegExp`/class instances), and
 *  — the trap the number `typeof` hides — for the IEEE-754 special values: `NaN`/`Infinity`
 *  /`-Infinity` all serialize to `"null"`, and `-0` serializes to `"0"` (colliding with `0`).
 *  A plain tree of string/FINITE-non-`-0`-number/boolean/null + plain objects/arrays
 *  round-trips injectively (up to key order, which `stableOptsKey` normalizes). */
function isJsonInjective(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "boolean") return true;
  // A number is injective EXCEPT the values `JSON.stringify` can't tell apart: NaN/±Infinity
  // (all → "null") and -0 (→ "0", colliding with 0). Reject those so two divergent numeric
  // opts (a NaN "disabled" sentinel vs an Infinity "never" sentinel) can't fold to one slot.
  if (t === "number") return Number.isFinite(v) && !Object.is(v, -0);
  if (t !== "object") return false; // undefined / function / symbol / bigint — lossy
  if (Array.isArray(v)) return v.every(isJsonInjective);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false; // Set/Map/Date/RegExp/class
  // A plain object: every own-enumerable value must itself be injective (an `undefined`
  // value would be dropped, colliding `{a:1,b:undefined}` with `{a:1}`).
  return Object.values(v as Record<string, unknown>).every(isJsonInjective);
}

/**
 * A STABLE, order-independent key fragment for a set of SHARED subscription options, so
 * two `.use()` sites that pass DIVERGENT options (a different `authority` / `initial` /
 * `coalesceMs` / `applyPatch`) get DISTINCT cache slots — divergent configs ARE two
 * subscriptions, not one silently-shared-by-convention. Data values serialize as JSON
 * (keys sorted for determinism); function values contribute a WeakMap-assigned stable id
 * (identity). Per-consumer options (`onError`/`onComplete`) are NOT passed here — they are
 * wired per-consumer on the shared value, never fold into the slot's identity.
 *
 * A non-injective-JSON data value (a `Set`/`Map`/`undefined`-bearing `initial`, or a
 * `NaN`/`±Infinity`/`-0` number) THROWS:
 * `JSON.stringify` can't distinguish it, so two divergent `.use()` would silently share one
 * subscription (the sharing-by-convention defect). Rejecting it makes that unrepresentable
 * NOW — a `Set`-valued shared option needs per-consumer wiring, which is demand-gated (not
 * yet built, since no live consumer passes one). Same discipline as the whole-collection
 * second-`onError` throw.
 */
export function stableOptsKey(opts: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(opts).sort()) {
    const v = opts[k];
    if (v === undefined) continue;
    if (typeof v === "function") {
      parts.push(`${k}=fn#${fnId(v as object)}`);
      continue;
    }
    if (!isJsonInjective(v)) {
      throw new Error(
        `surface dedup: the .use() option "${k}" is a non-injective-JSON value (a Set/Map/undefined-bearing object, or a NaN/±Infinity/-0 number) — the shared-slot dedup key can't distinguish it, so two divergent .use() sites would silently share one subscription. Use a plain-JSON option value (finite, non-(-0) numbers), or per-consumer wiring (not yet built) is needed for a non-plain-JSON shared option.`,
      );
    }
    parts.push(`${k}=${JSON.stringify(v)}`);
  }
  return parts.join("&");
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
