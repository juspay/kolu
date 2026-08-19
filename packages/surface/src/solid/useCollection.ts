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
 * `valueSource` is a typed member ref (the collection's per-key `get`) plus a
 * `keyToInput` adapter — the input shape per key varies by member (some take
 * `{ id }`, some take `{ key }`, some take the raw key) and the framework can't
 * guess. The hook applies the framework's retry fence internally.
 */

import type { Stream } from "effect";
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
  untrack,
} from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { type StreamingProcedure, unenrolledStreamCall } from "../client";
import type { CollectionDelta, CollectionDeltasMsg } from "../define";
import type { Collection } from "../index";
import { runStreamScoped } from "../runStream";
import {
  createSubscription,
  framesEqual,
  type Subscription,
  type SubscriptionOptions,
  wireSubscriptionError,
} from "./createSubscription";

export interface UseCollectionOptions<K, T, I> {
  /** Reactive accessor for the live key set. The caller owns the subscription
   *  (or computation) that produces this — useCollection just observes it. */
  keys: Accessor<K[]>;
  /** Typed streaming member ref for one key's value stream. The hook applies the
   *  retry fence per key. */
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
  collDescriptor: Collection<Name, K, T>,
  options: UseCollectionOptions<K, T, I>,
): UseCollectionResult<K, T> {
  const keys = createMemo<K[]>(() => options.keys());

  // mapArray creates a reactive owner per key. When a key leaves, its
  // owner is disposed → the per-key sub's onCleanup → AbortController abort
  // → server stream closes. No manual teardown.
  const perKey = mapArray(keys, (key) => {
    const sub = createSubscription(
      unenrolledStreamCall(options.valueSource, options.keyToInput(key), {
        // The `client.health()` per-key spelling (`<key>[<id>]`), reused rather
        // than re-spelled, so the liveness registry and the health fact name one
        // subscription one way (kolu#2101 J2).
        label: `${collDescriptor.name}[${String(key)}]`,
      }),
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
// `deltas` stream instead: one frame per tick, applied to a store it owns by
// NAMED-KEY writes, so per-key reads stay fine-grained (only the keys the frame
// named re-notify). It exposes the SAME `{ keys, byKey }` surface as
// `useCollection`, so the bound `.use()` can pick either delivery with no
// call-site change.
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
 *  `Object.prototype`. Solid treats a null-prototype object as wrappable
 *  (`isWrappable`), so per-key reactivity is intact. */
function emptyDict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Crash loudly on a key that violates the homogeneous-primitive-key CONSTRAINT
 *  above, at the point the bad key enters the store (every snapshot entry, every
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

/** Guard the deltas store's homogeneous-primitive-key precondition (the CONSTRAINT
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

/** The collection-wide subscription signals of a batched `deltas` view — the ONE
 *  stream's own `error` / `pending` / `complete`, shared by every key's accessor
 *  (there is no per-key stream to carry its own). Structurally a health
 *  `HealthSource`, so `enroll` hands it straight to the client health registry;
 *  `byKey` hands the same three onto every accessor it mints, which is what makes
 *  the result `Subscription`-shaped without a second subscription existing. */
export interface CollectionStreamState {
  readonly error: Accessor<Error | undefined>;
  readonly pending: Accessor<boolean>;
  readonly complete: Accessor<boolean>;
}

/** Membership equality for the arrival-order key list. `keys()` must NOT re-notify
 *  on a values-only tick (nor on a reconnect snapshot that names the same set), so
 *  the order signal compares by MEMBERSHIP-AND-POSITION and keeps the previous array
 *  when they match — the "order by reference" rule, held by the signal rather than
 *  re-derived at each write site. */
function sameOrder<K>(a: readonly K[], b: readonly K[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

export function useCollectionDeltas<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  options: {
    /** The collection's `deltas` stream (snapshot-then-deltas), already fenced.
     *  Lazy — tearing down the last consumer of a shared dedup slot interrupts the
     *  subscription's fiber, and the stream's own finalizers cancel upstream. */
    source: Stream.Stream<CollectionDeltasMsg<K, T>, unknown>;
    onError?: SubscriptionOptions<unknown>["onError"];
    /** Fired when the batched stream ends NORMALLY (typed end) — the surface client
     *  threads the keyed cache's slot eviction here so a re-served collection rebuilds. */
    onComplete?: () => void;
    /** Enrol the single batched subscription into the client health registry. */
    enroll?: (state: CollectionStreamState) => void;
  },
): UseCollectionResult<K, T> {
  // THE store, owned here rather than reached through `createSubscription`'s generic
  // reduce: a frame NAMES the keys it touches, and the whole point of this path is to
  // write exactly those. Routing through the reduce path meant a fresh accumulator per
  // frame (a whole-dict copy) which `reconcile` then walked in full to rediscover the
  // keys the frame had already named — two O(N) passes per O(|frame|) update.
  const [byKey_, setByKey] = createStore<Record<string, T>>(emptyDict<T>());
  // The UNTRACKED view of the same dictionary (`createStore` wraps this exact object).
  // Every read inside the frame loop goes through it: the loop is deciding what to
  // write, not rendering, so tracking there would be noise at best.
  const held = unwrap(byKey_);
  const [order, setOrder] = createSignal<K[]>([], { equals: sameOrder });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);
  const state: CollectionStreamState = { error, pending, complete };

  const currentOrder = (): K[] => untrack(order);

  /** Apply a FULL-SET frame. O(N), which is inherent — the frame carries N entries.
   *
   *  VALUE-diffed, not reference-diffed, and that is load-bearing: the retry fence
   *  turns a transport drop into a fresh snapshot rather than an error, so a
   *  reconnect re-serializes the same content into fresh objects. An entry whose
   *  value is unchanged must therefore NOT re-notify its readers — a link flap is
   *  deliberately a visual no-op. An entry that DID change is REPLACED whole (never
   *  merged into the object standing there) — the same replaced-rather-than-recycled
   *  law `writeValue.ts` states for array elements, one level down. */
  function applySnapshot(entries: ReadonlyArray<readonly [K, T]>): void {
    const next = emptyDict<T>();
    const nextOrder: K[] = [];
    for (const [k, v] of entries) {
      assertFoldableKey(k);
      next[String(k)] = v;
      nextOrder.push(k);
    }
    assertKeysInjective(next, nextOrder);
    setByKey(
      produce((dict) => {
        for (const sk of Object.keys(held)) if (!(sk in next)) delete dict[sk];
        for (const sk of Object.keys(next)) {
          if (!(sk in held) || !framesEqual(held[sk], next[sk])) {
            dict[sk] = next[sk] as T;
          }
        }
      }),
    );
    setOrder(nextOrder);
  }

  /** Apply ONE coalesced delta frame: one named-key store write per upsert, one
   *  delete per remove. O(|frame|) — no dict copy, no walk over the keys the frame
   *  did not name, and only the named keys' readers re-notify. */
  function applyDelta(delta: CollectionDelta<K, T>): void {
    // Keys NEW to this frame, and removes that name a key actually held. Newness is
    // the O(1) `String(k) in held` over the dictionary's pre-write key set — no
    // per-frame `Set(order)` sized to the whole collection. A remove of an absent key
    // is a harmless no-op, so it needs no `assertFoldableKey` (a bad key never
    // entered the dictionary — the upsert arm asserts).
    const added: K[] = [];
    for (const [k] of delta.upserts) {
      assertFoldableKey(k);
      if (!(String(k) in held)) added.push(k);
    }
    const removed = delta.removes.filter((k) => String(k) in held);
    setByKey(
      produce((dict) => {
        // A LEAF REPLACEMENT per named key, not a merge into the object already
        // there: the store must never mutate a frame object it previously adopted.
        for (const [k, v] of delta.upserts) dict[String(k)] = v;
        for (const k of removed) delete dict[String(k)];
      }),
    );
    // Key set UNCHANGED (a pure value-update tick) → nothing to write; the order
    // signal keeps its array BY REFERENCE and `keys()` stays quiet.
    if (added.length === 0 && removed.length === 0) return;
    // Rebuild only when membership moved. `Set(removed)` is sized to the (small)
    // removal set, never to the whole collection.
    let nextOrder: K[];
    if (removed.length > 0) {
      const gone = new Set<K>(removed);
      nextOrder = currentOrder().filter((k) => !gone.has(k));
    } else {
      nextOrder = currentOrder().slice();
    }
    for (const k of added) nextOrder.push(k);
    // A String() collision can only appear when a NEW key enters.
    if (added.length > 0) assertKeysInjective(held, nextOrder);
    setOrder(nextOrder);
  }

  function onFrame(msg: CollectionDeltasMsg<K, T>): void {
    // One tick for the whole frame: no reader observes a half-applied frame.
    batch(() => {
      // Assert keys → apply to the store → clear `pending`.
      if (msg.kind === "snapshot") applySnapshot(msg.entries);
      else applyDelta(msg);
      if (pending()) setPending(false);
    });
  }

  const stop = runStreamScoped<CollectionDeltasMsg<K, T>>(options.source, {
    onFrame,
    onEnd: () => {
      if (pending()) setPending(false);
      setComplete(true);
      options.onComplete?.();
    },
    // The batched stream's error is collection-wide and TERMINAL (retry-fence
    // exhaustion, or a declared failure). The store keeps its last value, frozen —
    // there is no further frame to change it.
    onFailure: (err) => {
      setError(err);
      if (pending()) setPending(false);
    },
  });
  onCleanup(stop);

  if (options.onError) wireSubscriptionError(state, options.onError);
  options.enroll?.(state);

  function byKey(key: K): Subscription<T> | undefined {
    // Match the per-key path's contract: a key absent from the live set reads
    // `undefined`, NOT a live accessor — so `if (byKey(k))` and `byKey(k)?.pending()`
    // mean the same across both delivery paths. The `in` check is tracked by the
    // store's `has` trap, so this re-evaluates when the key is added/removed
    // (`Object.hasOwn` would read an untracked descriptor and miss those updates).
    // The dictionary is null-prototype, so a stray inherited name like `toString`
    // reads absent rather than shadowing.
    const sk = String(key);
    if (!(sk in byKey_)) return undefined;
    // A per-key accessor over the shared store — reading `byKey_[sk]` in a tracking
    // scope tracks only that leaf. `error`/`pending`/`complete` are the single
    // stream's, shared across keys.
    const read = (() => byKey_[sk]) as Subscription<T>;
    return Object.assign(read, state);
  }

  return { keys: order, byKey };
}
