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
import type { CollectionDeltasMsg } from "../define";
import type { Collection } from "../index";
import {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";

export interface UseCollectionOptions<K, T, I> {
  /** Reactive accessor for the live key set. The caller owns the subscription
   *  (or computation) that produces this — useCollection just observes it. */
  keys: Accessor<K[]>;
  /** Typed streaming procedure ref for one key's value stream. Hook
   *  threads `STREAM_RETRY` context per call. */
  valueSource: StreamingProcedure<I, T>;
  /** Adapter from key to procedure input shape. Always required (even
   *  when `I = K`) — without it the framework would have to silently cast
   *  the key to whatever shape the procedure expects, which crashes the
   *  procedure at runtime when the shapes differ. Identity callers
   *  spell out `(k) => k`. */
  keyToInput: (key: K) => I;
  /** Called when any per-key subscription errors. */
  onError?: SubscriptionOptions<unknown>["onError"];
  /** Enrol each per-key value subscription into a client health registry
   *  (`surfaceClient` wires this). Invoked inside the `mapArray` factory — i.e.
   *  the per-key reactive owner — so the registry's matching `onCleanup` drop
   *  fires when the key leaves the set, on the SAME owner disposal the
   *  subscription's own teardown already rides. Without it, a per-key sub error
   *  would be invisible to `client.health()` and the registry would not be
   *  TOTAL. */
  enroll?: (key: K, sub: Subscription<T>) => void;
}

export interface UseCollectionResult<K, T> {
  /** Reactive accessor for the current key set (passes through `options.keys`). */
  keys: Accessor<K[]>;
  /** Reactive accessor for the value at `key`, or `undefined` if not yet
   *  yielded. The per-key subscription is created lazily and disposed
   *  when the key leaves the set.
   *
   *  DELIVERY-PATH CONTRACT — this receptacle backs BOTH delivery paths
   *  (`useCollection`'s per-key streams and `useCollectionDeltas`'s single
   *  batched stream), and the encapsulated axis leaks on two points a consumer
   *  must know: (1) the value read is identical across paths, but `error()` /
   *  `pending()` are NOT — under per-key delivery they are THAT key's own
   *  stream's, while under batched delivery (a collection opted into the `deltas`
   *  verb) they are the SINGLE batched stream's: collection-wide, shared across
   *  keys, not per-key; (2) `keys()` is arrival-order under batched delivery and
   *  not stable across the two paths — treat it as a set, not an ordered list. */
  byKey: (key: K) => Subscription<T> | undefined;
}

export function useCollection<Name extends string, K, T, I>(
  _coll: Collection<Name, K, T>,
  options: UseCollectionOptions<K, T, I>,
): UseCollectionResult<K, T> {
  const keys = createMemo<K[]>(() => options.keys());

  // mapArray creates a reactive owner per key. When a key leaves, its
  // owner is disposed → the per-key sub's onCleanup → AbortController abort
  // → server stream closes. No manual teardown.
  const perKey = mapArray(keys, (key) => {
    const sub = createSubscription(
      () =>
        options.valueSource(options.keyToInput(key), { context: STREAM_RETRY }),
      { onError: options.onError },
    );
    // Enrol this per-key sub into the client health registry (when wired). Runs
    // in the per-key owner, so the registry's `onCleanup` drop fires on the same
    // disposal that tears the subscription down when this key leaves the set.
    options.enroll?.(key, sub);
    return { key, sub };
  });

  function byKey(key: K): Subscription<T> | undefined {
    return perKey().find((p) => p.key === key)?.sub;
  }

  return { keys, byKey };
}

// ── Batched `deltas` delivery (the whole-collection fast path) ──────────────
//
// The per-key `useCollection` above opens one stream PER key — right for a
// narrowed subset ("watch these few keys"), but for a whole collection that
// ticks every key every frame it costs N wire frames + N async-iterators per
// tick. `useCollectionDeltas` consumes the collection's SINGLE coalesced
// `deltas` stream instead: one frame per tick, folded into a reconcile-backed
// store so per-key reads stay fine-grained (only the keys that changed
// re-notify). It exposes the SAME `{ keys, byKey }` surface as `useCollection`,
// so the bound `.use()` can pick either delivery with no call-site change.
//
// CONSTRAINT: `deltas` requires HOMOGENEOUS PRIMITIVE keys — a `keySchema` that
// is a single number or string type (true of every Collection key in practice:
// pids, host names, terminal ids, core indices, NIC names). The value store is
// keyed by `String(key)`, so a union `keySchema` admitting both `1` and `"1"`
// would collapse them; an object keySchema would collapse to `"[object Object]"`.
// The per-key `get` path keys by real `===` and has no such limit, so don't opt
// a heterogeneous-key collection into `deltas`.
//
// The precondition is ENFORCED, not just documented: `assertFoldableKey` crashes
// on a non-primitive key (so a single object key — which `assertKeysInjective`'s
// length compare can't catch on its own — fails fast) and on the literal
// `"__proto__"` (the Solid store proxy special-cases that name in BOTH its `get`
// and `has` traps, so it could never be stored or queried safely whatever the
// dictionary's prototype). The value store is a NULL-PROTOTYPE dict, so inherited
// names (`toString`, `constructor`, …) are absent from the `in`-membership check
// rather than shadowing a real key; the `in` operator (not `Object.hasOwn`) is
// kept because only Solid's `has` trap registers the reactive existence
// dependency — `Object.hasOwn` reads `getOwnPropertyDescriptor`, which the store
// proxy does not track, so it would silently break per-key reactivity.

/** A fresh NULL-PROTOTYPE value store. `Object.create(null)` (not `{}`) so a key
 *  like `"toString"` is absent from `in`-membership instead of inherited from
 *  `Object.prototype`. Solid's `reconcile` treats a null-prototype object as
 *  wrappable (`isWrappable`), so per-key reactivity is intact. */
function emptyDict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** The folded collection: values keyed by `String(key)` (a reconcile-backed
 *  null-prototype object, for fine-grained per-key reactivity) plus the
 *  real-typed key list in arrival order (so `keys()` returns `K[]`, not
 *  stringified keys). */
interface DeltasFold<K, T> {
  byKey: Record<string, T>;
  order: K[];
}

/** Crash loudly on a key that violates the homogeneous-primitive-key CONSTRAINT
 *  above, at the point the bad key enters the fold (every snapshot entry, every
 *  delta upsert/remove) — so corruption can't be expressed, not merely detected
 *  after. Rejects (1) a non-primitive key: `byKey` is keyed by `String(key)`, so
 *  an object/symbol/null/boolean key is a silent collapse the length compare in
 *  {@link assertKeysInjective} can't always catch (a SINGLE object key collapses
 *  nothing). (2) the literal `"__proto__"`: the Solid store proxy special-cases
 *  that name in its `get`/`has` traps regardless of the dict's prototype, so it
 *  can never round-trip. */
function assertFoldableKey(key: unknown): void {
  const t = typeof key;
  if (t !== "number" && t !== "string") {
    throw new Error(
      `deltas key must be a primitive number or string, got ${t} — deltas requires homogeneous primitive keys`,
    );
  }
  if (key === "__proto__") {
    throw new Error(
      'deltas key "__proto__" is reserved — the reactive store special-cases it and cannot serve it',
    );
  }
}

/** Guard the delta fold's homogeneous-primitive-key precondition (the CONSTRAINT
 *  above): `byKey` is keyed by `String(key)` while `order` holds the real keys,
 *  so two DISTINCT real keys that collapse to one string (a union admitting both
 *  `1` and `"1"`) leave `byKey` STRICTLY SHORTER than `order`. Fires exactly on
 *  that collision (a single length compare). Crash loudly at the point of
 *  corruption rather than silently serving a collapsed set — the fail-fast the
 *  prose constraint can only ask for. (`assertFoldableKey` already rejects the
 *  non-primitive single-key case this length compare alone would miss.) */
function assertKeysInjective<K, T>(
  byKey: Record<string, T>,
  order: readonly K[],
): void {
  if (Object.keys(byKey).length !== order.length) {
    throw new Error(
      "deltas key collision: keys are not String()-injective — deltas requires homogeneous primitive keys",
    );
  }
}

/** Fold one `deltas` frame into the accumulated collection. A `snapshot`
 *  replaces the whole set; a `delta` applies upserts then removes onto a copy.
 *  Returns a new object each call — `createSubscription`'s `reconcile` makes the
 *  store update granular, so a new accumulator does not mean a coarse re-render. */
export function foldCollectionDeltas<K, T>(
  acc: DeltasFold<K, T>,
  msg: CollectionDeltasMsg<K, T>,
): DeltasFold<K, T> {
  if (msg.kind === "snapshot") {
    const byKey = emptyDict<T>();
    const order: K[] = [];
    for (const [k, v] of msg.entries) {
      assertFoldableKey(k);
      byKey[String(k)] = v;
      order.push(k);
    }
    assertKeysInjective(byKey, order);
    return { byKey, order };
  }
  // Copy onto a fresh NULL-PROTOTYPE dict (`{ ...acc.byKey }` would reintroduce
  // `Object.prototype`); `Object.assign` keeps the null prototype.
  const byKey = Object.assign(emptyDict<T>(), acc.byKey);
  for (const [k, v] of msg.upserts) {
    assertFoldableKey(k);
    byKey[String(k)] = v;
  }
  for (const k of msg.removes) {
    assertFoldableKey(k);
    delete byKey[String(k)];
  }
  // `order` is the real-typed key set: keep membership/removal on the real keys
  // (`===`-keyed Sets), so only the value store's `byKey` stringifies. One
  // stringification site, not four threaded through the order logic.
  const removed = new Set(msg.removes);
  const existing = new Set(acc.order);
  const order = acc.order.filter((k) => !removed.has(k));
  for (const [k] of msg.upserts) {
    if (!existing.has(k)) order.push(k);
  }
  assertKeysInjective(byKey, order);
  return { byKey, order };
}

export function useCollectionDeltas<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  options: {
    /** The collection's `deltas` stream factory (snapshot-then-deltas). */
    source: () => Promise<AsyncIterable<CollectionDeltasMsg<K, T>>>;
    onError?: SubscriptionOptions<unknown>["onError"];
    /** Enrol the single batched subscription into the client health registry. */
    enroll?: (sub: Subscription<DeltasFold<K, T>>) => void;
  },
): UseCollectionResult<K, T> {
  const sub = createSubscription<CollectionDeltasMsg<K, T>, DeltasFold<K, T>>(
    options.source,
    {
      initial: { byKey: emptyDict<T>(), order: [] },
      reduce: foldCollectionDeltas,
      onError: options.onError,
    },
  );
  options.enroll?.(sub);

  const keys = createMemo<K[]>(() => sub()?.order ?? []);

  function byKey(key: K): Subscription<T> | undefined {
    // Match the per-key path's contract: a key absent from the live set reads
    // `undefined`, NOT a live accessor — so `if (byKey(k))` and
    // `byKey(k)?.pending()` mean the same across both delivery paths. The `in`
    // check is tracked by the reconcile store's `has` trap, so this re-evaluates
    // when the key is added/removed (`Object.hasOwn` would read an untracked
    // descriptor and miss those updates). `byKey` is null-prototype, so a stray
    // inherited name like `toString` reads absent rather than shadowing.
    const fold = sub() as DeltasFold<K, T> | undefined;
    if (fold === undefined || !(String(key) in fold.byKey)) return undefined;
    // A per-key accessor over the shared store — reading `byKey[String(key)]`
    // in a tracking scope tracks only that leaf (reconcile keeps it granular).
    // `error`/`pending` are the single stream's, shared across keys.
    const read = (() =>
      (sub() as DeltasFold<K, T> | undefined)?.byKey[
        String(key)
      ]) as Subscription<T>;
    return Object.assign(read, { error: sub.error, pending: sub.pending });
  }

  return { keys, byKey };
}
