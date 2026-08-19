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
  createMemo,
  createSignal,
  getOwner,
  mapArray,
  onCleanup,
  untrack,
} from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { type StreamingProcedure, unenrolledStreamCall } from "../client";
import type { CollectionDelta, CollectionDeltasMsg } from "../define";
import type { Collection } from "../index";
import {
  createStreamLifecycle,
  createSubscription,
  framesEqual,
  type Subscription,
  type SubscriptionOptions,
  type SubscriptionState,
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
// `useCollection` — so the bound `.use()` can pick either delivery with no
// call-site change — plus `fold`, the frame socket a per-key path has nothing to
// put behind.
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
 *  above): the dictionary is keyed by `String(key)` while `order` holds the REAL
 *  keys, so two distinct real keys that collapse to one string (a union admitting
 *  both `1` and `"1"`) leave the dictionary STRICTLY SMALLER than the key list.
 *  Fires exactly on that divergence. Crash loudly at the point of corruption rather
 *  than silently serving a collapsed set — the fail-fast the prose constraint can
 *  only ask for. (`assertFoldableKey` already rejects the non-primitive single-key
 *  case a size compare alone would miss.)
 *
 *  The dictionary's size is TRACKED as frames are applied rather than counted, so a
 *  frame naming three keys of two thousand pays O(1) to be checked and the guard can
 *  run after EVERY membership move instead of only when a key was added. Tracked
 *  means MEASURED at the write — a size predicted from the frame would make both
 *  operands derivations of the same arrays, and the compare would only ever catch
 *  its own arithmetic.
 *
 *  What it catches is a colliding key ENTERING the set. A key whose string is
 *  already held (`"1"` arriving where `1` stands) overwrites that slot without
 *  growing either side, and is caught on the next full-set frame instead — the
 *  snapshot arm counts membership straight off the frame. */
function assertKeysInjective(dictSize: number, orderLength: number): void {
  if (dictSize !== orderLength) {
    throw new Error(
      "deltas key collision: keys are not String()-injective — deltas requires homogeneous primitive keys",
    );
  }
}

/** Fold a `deltas` collection's frames into a CONSUMER-OWNED accumulator.
 *
 *  The frame is the unit of update: `step` receives the wire's own
 *  `{upserts, removes}`, unchanged and unfiltered. This is the socket for a
 *  consumer whose accumulator is NOT a keyed dictionary — an index, a patched
 *  document set, a running total — which would otherwise have to reconstruct
 *  "what changed" from the keyed store the framework already applied the frame to. */
export interface CollectionFoldOptions<K, T, A> {
  /** Answer for a FULL-SET frame: the wire's first frame, every reconnect
   *  snapshot, and the synthetic snapshot a fold registered mid-stream is seeded
   *  with. Entries are in arrival order. */
  init: (entries: ReadonlyArray<readonly [K, T]>) => A;
  /** Answer for ONE coalesced delta frame. MUST be TOTAL over removes of keys it
   *  has never seen: the server's tick coalescer resolves an upsert-then-remove
   *  within one producer tick to a BARE remove, so a key born and dead inside one
   *  tick reaches the wire as a remove never preceded by an upsert. The frame is
   *  delivered verbatim — filtering it here would be the framework swallowing part
   *  of the frame again, which is the whole shape this socket exists to undo. */
  step: (acc: A, delta: CollectionDelta<K, T>) => A;
}

/** Register a fold over this collection's frames; returns its accumulator as a
 *  reactive accessor.
 *
 *  `undefined` has exactly ONE meaning: there is no valid accumulator. That is the
 *  state before the first snapshot — synchronous if one has already landed, since a
 *  mid-stream registration is seeded from the held store, so arriving late is
 *  indistinguishable from a reconnect — and the state a throwing `init`/`step`
 *  returns the fold to, reported loudly, until the next snapshot re-seeds it. MUST
 *  be called under a reactive owner: the
 *  registration is dropped by that owner's `onCleanup`, and an ownerless fold would
 *  accumulate for the life of the shared collection slot, so an ownerless call
 *  THROWS rather than minting an instantly-dead accumulator. */
export type CollectionFold<K, T> = <A>(
  options: CollectionFoldOptions<K, T, A>,
) => Accessor<A | undefined>;

/** `useCollectionDeltas`'s result: the per-key view every collection has, plus the
 *  two things only the batched path can offer — the frame socket, and the ONE
 *  stream's own health.
 *
 *  `stream` is here for the DELIBERATELY UN-ENROLLED reach, which is why the hook is
 *  public at all: a consumer that takes `.unenrolledDeltas` has no `client.health()`
 *  fact to join its feed to, so a dead feed has to surface through this accessor or
 *  not at all. The enrolled `.use()` does NOT re-expose it — there it is the health
 *  fact's job, and a parallel accessor a consumer must remember to read is exactly
 *  what {@link UseCollectionResult.byKey}'s delivery-path note warns against. */
export interface UseCollectionDeltasResult<K, T>
  extends UseCollectionResult<K, T> {
  fold: CollectionFold<K, T>;
  /** The single batched stream's `error` / `pending` / `complete` — collection-wide
   *  and shared across keys, NOT per-key. The same three every `byKey` accessor
   *  carries, reachable without first having a present key to ask through. */
  stream: SubscriptionState;
}

/** One registered fold, reduced to what the frame loop needs: two guarded callbacks.
 *  The accumulator's type lives inside their closure, so the registry is
 *  homogeneous without a cast and a throwing consumer callback is contained where
 *  its own state is. */
interface FoldSlot<K, T> {
  /** Re-initialize from a full-set frame (wire snapshot, or the synthetic one a
   *  mid-stream registration is seeded with). */
  readonly seed: (entries: ReadonlyArray<readonly [K, T]>) => void;
  /** Apply one delta frame. A no-op while this fold has no valid accumulator — a
   *  delta has nothing to land on until a snapshot has built one. */
  readonly step: (delta: CollectionDelta<K, T>) => void;
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
    enroll?: (state: SubscriptionState) => void;
  },
): UseCollectionDeltasResult<K, T> {
  // THE store, owned here rather than reached through `createSubscription`'s generic
  // reduce: a frame NAMES the keys it touches, and the whole point of this path is to
  // write exactly those. Routing through the reduce path meant a fresh accumulator per
  // frame (a whole-dict copy) which `reconcile` then walked in full to rediscover the
  // keys the frame had already named — two O(N) passes per O(|frame|) update.
  const [dict, setDict] = createStore<Record<string, T>>(emptyDict<T>());
  // The UNTRACKED view of the same dictionary (`createStore` wraps this exact object).
  // Every read inside the frame loop goes through it: the loop is deciding what to
  // write, not rendering, so tracking there would be noise at best.
  const held = unwrap(dict);
  const [order, setOrder] = createSignal<K[]>([], { equals: sameOrder });

  const folds = new Set<FoldSlot<K, T>>();
  /** Whether a full-set frame has been applied — i.e. whether the held store is a
   *  state a fold can be seeded from, and whether a delta has a base to land on. */
  let seeded = false;
  /** How many entries the dictionary holds. Tracked as frames are applied so
   *  {@link assertKeysInjective} costs O(1) rather than a walk over every key. */
  let size = 0;

  const currentOrder = (): K[] => untrack(order);

  /** Apply a FULL-SET frame. O(N), which is inherent — the frame carries N entries.
   *
   *  VALUE-diffed, not reference-diffed, and that is load-bearing: the retry fence
   *  turns a transport drop into a fresh snapshot rather than an error, so a
   *  reconnect re-serializes the same content into fresh objects. An entry whose
   *  value is unchanged must therefore NOT re-notify its readers — a link flap is
   *  deliberately a visual no-op. An entry that DID change is REPLACED whole (never
   *  merged into the object standing there), because that object is the same one a
   *  fold may be holding: from the store's point of view a frame handed onward is
   *  frozen. */
  function applySnapshot(entries: ReadonlyArray<readonly [K, T]>): void {
    const present = new Set<string>();
    const nextOrder: K[] = [];
    for (const [k] of entries) {
      assertFoldableKey(k);
      present.add(String(k));
      nextOrder.push(k);
    }
    assertKeysInjective(present.size, nextOrder.length);
    setDict(
      produce((d) => {
        for (const sk of Object.keys(held)) if (!present.has(sk)) delete d[sk];
        for (const [k, v] of entries) {
          const sk = String(k);
          if (!(sk in held) || !framesEqual(held[sk], v)) d[sk] = v;
        }
      }),
    );
    size = present.size;
    setOrder(nextOrder);
  }

  /** Apply ONE coalesced delta frame: one named-key store write per upsert, one
   *  delete per remove. O(|frame|) — no dict copy, no walk over the keys the frame
   *  did not name, and only the named keys' readers re-notify.
   *
   *  Writes UNCONDITIONALLY, unlike {@link applySnapshot}: the
   *  "unchanged value must not re-notify" rule is the snapshot arm's, and
   *  deliberately only its. A delta names a key BECAUSE the producer decided it
   *  changed — that is what the collection's declared `equals` dedup upstream
   *  already answered — so a deep compare here would re-ask a question already
   *  answered and pay per named key for it. The snapshot arm has no such answer to
   *  lean on: a reconnect re-serializes the WHOLE set whether or not anything
   *  moved. */
  function applyDelta(delta: CollectionDelta<K, T>): void {
    // Keys NEW to the collection as of THIS FRAME'S START, computed against the
    // PRE-write dictionary. That "pre-write" is load-bearing, not incidental: two
    // distinct real keys that collapse to one string are BOTH new here, so both
    // enter `order`, while the dictionary below gains only ONE slot. That gap is
    // precisely what the injectivity guard is looking for — checking newness against
    // the dictionary mid-write would close it and make the collision unspellable to
    // the guard rather than to the wire. A remove of an absent key is a harmless
    // no-op, so it needs no `assertFoldableKey` (a bad key never entered the
    // dictionary — the upsert arm asserts).
    const added: K[] = [];
    for (const [k] of delta.upserts) {
      assertFoldableKey(k);
      if (!(String(k) in held)) added.push(k);
    }
    // The dictionary's ACTUAL size change, and the removes that actually landed,
    // both MEASURED inside the one pass that performs the writes — never predicted
    // from the frame. Predicting them from `added`/`delta.removes` makes both
    // operands of the guard below derivations of the same two arrays, so the compare
    // becomes a tautology that can only catch its own arithmetic: a frame carrying
    // `1` and `"1"` would pass, which is the one case the guard is named for.
    let net = 0;
    const removed: K[] = [];
    setDict(
      produce((d) => {
        // A LEAF REPLACEMENT per named key, not a merge into the object already
        // there: the store must never mutate a frame object it previously adopted,
        // since a fold may be holding that same object (§ the aliasing contract).
        for (const [k, v] of delta.upserts) {
          const sk = String(k);
          if (!(sk in d)) net++;
          d[sk] = v;
        }
        for (const k of delta.removes) {
          const sk = String(k);
          if (!(sk in d)) continue; // absent, or already removed by this same frame
          delete d[sk];
          net--;
          removed.push(k);
        }
      }),
    );
    size += net;
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
    assertKeysInjective(size, nextOrder.length);
    setOrder(nextOrder);
  }

  /** The full-set frame a fold registered MID-STREAM is seeded with, rebuilt from the
   *  held store. The keyed cache shares ONE slot per collection, so a late fold
   *  cannot be handed the wire's own snapshot back — it is handed the state that
   *  snapshot produced, which is the same answer. */
  function syntheticSnapshot(): [K, T][] {
    return currentOrder().map((k) => {
      const value = held[String(k)];
      if (value === undefined) {
        // The key list and the dictionary are written together on every frame and
        // their sizes are guarded equal, so a key in one and not the other is a
        // corrupted store, not a late arrival. Say so, rather than seeding a
        // consumer's fold with a hole it has no way to recognise.
        throw new Error(
          `deltas store is inconsistent: key ${String(k)} is in the key set but has no value`,
        );
      }
      return [k, value];
    });
  }

  // The fiber, the three signals and the teardown path are the shared seam; the ONE
  // thing this hook contributes is what a frame DOES. Its error is collection-wide
  // and TERMINAL (retry-fence exhaustion, or a declared failure) — the store and
  // every fold accessor then keep their last value, frozen, because no further frame
  // can change them.
  const state = createStreamLifecycle<CollectionDeltasMsg<K, T>>(
    options.source,
    {
      // Assert keys → apply to the store → notify the folds. The lifecycle runs this
      // inside ONE batch and clears `pending` after it, so no reader ever observes a
      // half-applied frame, and folds run AFTER the store write — a `step` that reads
      // `byKey` (discouraged, but expressible) sees state consistent with its frame.
      onFrame: (msg) => {
        if (msg.kind === "snapshot") {
          applySnapshot(msg.entries);
          seeded = true;
          // A snapshot RE-INITIALIZES every registered fold. The consumer never
          // distinguishes first-connect from reconnect; both are "here is the whole
          // set".
          for (const slot of [...folds]) slot.seed(msg.entries);
        } else {
          applyDelta(msg);
          for (const slot of [...folds]) slot.step(msg);
        }
      },
      onComplete: options.onComplete,
      onError: options.onError,
    },
  );
  options.enroll?.(state);

  const fold = <A>(
    foldOptions: CollectionFoldOptions<K, T, A>,
  ): Accessor<A | undefined> => {
    if (getOwner() === null) {
      throw new Error(
        "useCollectionDeltas: fold() must be called under a reactive owner — its registration is dropped by that owner's onCleanup, and an ownerless fold would accumulate for the life of the shared collection slot",
      );
    }
    // `equals: false`: the framework cannot know whether `A` is a value or an
    // accumulator the consumer mutates and returns, so it must never decide that a
    // frame changed nothing. A spurious wake is harmless; a swallowed update is the bug.
    const [value, setValue] = createSignal<A | undefined>(undefined, {
      equals: false,
    });
    let acc: { kind: "unseeded" } | { kind: "seeded"; value: A } = {
      kind: "unseeded",
    };
    const commit = (next: A): void => {
      acc = { kind: "seeded", value: next };
      setValue(() => next);
    };
    // A throwing `init`/`step` is contained PER FOLD and reported loudly — it must
    // never kill the stream, the store, or another fold (the same containment
    // `createUpdatedTracker` applies to `updated` handlers, for the same shared-slot
    // reason). The accumulator is INVALIDATED: applying later deltas onto a base
    // that failed to build is how a fold goes silently wrong. The accessor goes with
    // it, back to `undefined` — the ONE state "there is no valid accumulator", which
    // is where it started and where the next snapshot re-seeds it from. Keeping the
    // last good value instead would leave the accessor reading live while it can
    // never advance again, which a consumer cannot tell from healthy.
    const guard = (what: string, run: () => A): void => {
      try {
        commit(run());
      } catch (err) {
        acc = { kind: "unseeded" };
        setValue(() => undefined);
        console.error(`collection fold \`${what}\` threw`, err);
      }
    };
    const slot: FoldSlot<K, T> = {
      seed: (entries) => guard("init", () => foldOptions.init(entries)),
      step: (delta) => {
        if (acc.kind !== "seeded") return;
        const base = acc.value;
        guard("step", () => foldOptions.step(base, delta));
      },
    };
    folds.add(slot);
    onCleanup(() => {
      folds.delete(slot);
    });
    if (seeded) slot.seed(syntheticSnapshot());
    return value;
  };

  function byKey(key: K): Subscription<T> | undefined {
    // Match the per-key path's contract: a key absent from the live set reads
    // `undefined`, NOT a live accessor — so `if (byKey(k))` and `byKey(k)?.pending()`
    // mean the same across both delivery paths. The `in` check is tracked by the
    // store's `has` trap, so this re-evaluates when the key is added/removed
    // (`Object.hasOwn` would read an untracked descriptor and miss those updates).
    // The dictionary is null-prototype, so a stray inherited name like `toString`
    // reads absent rather than shadowing.
    const sk = String(key);
    if (!(sk in dict)) return undefined;
    // A per-key accessor over the shared store — reading `dict[sk]` in a tracking
    // scope tracks only that leaf. `error`/`pending`/`complete` are the single
    // stream's, shared across keys.
    const read = (() => dict[sk]) as Subscription<T>;
    return Object.assign(read, state);
  }

  return { keys: order, byKey, fold, stream: state };
}
