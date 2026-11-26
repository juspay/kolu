/**
 * `useCollection` — Solid hook for per-key reactive subscriptions over a
 * keyed server collection.
 *
 * The hook takes a reactive `keys` accessor — caller-provided so the keys
 * source can be anything (a server stream wrapped in createSubscription,
 * a derivation from a list-of-records subscription, a static array). Per-key
 * subscriptions are managed via `mapArray` so SolidJS handles the lifecycle:
 * when a key leaves the set, its reactive owner is disposed, the cleanup the
 * per-key subscription's own effect returned interrupts its fiber, and the stream's
 * finalizers tear the server subscription down. No manual Map / version signals /
 * abort plumbing required at the call site.
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
  createStore,
  getOwner,
  mapArray,
  onCleanup,
  runWithOwner,
} from "solid-js";
import { type StreamingProcedure, unenrolledStreamCall } from "../client";
import type { CollectionDelta, CollectionDeltasMsg } from "../define";
import { containThrow } from "../containThrow";
import type { Collection } from "../index";
import {
  createStreamLifecycle,
  createSubscription,
  framesEqual,
  noLifetimeRefusal,
  type Subscription,
  type SubscriptionOptions,
  type SubscriptionState,
} from "./createSubscription";
import { writeEntryValue } from "./writeValue";

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
   *  batched stream), and the encapsulated axis leaks on three points a consumer
   *  must know: (1) the value read is identical across paths, but `error()` /
   *  `pending()` are NOT — under per-key delivery they are THAT key's own
   *  stream's, while under batched delivery (a collection opted into the `deltas`
   *  verb) they are the SINGLE batched stream's: collection-wide, shared across
   *  keys, not per-key; (2) `keys()` is arrival-order under batched delivery and
   *  not stable across the two paths — treat it as a set, not an ordered list;
   *  (3) `updated()` — the change-iff-fired channel — is present only under per-key
   *  delivery, where a real `createSubscription` mints it. Under batched delivery
   *  the per-key handle is assembled from the one stream's signals and omits it
   *  (which {@link Subscription} permits), so a consumer that needs "what changed"
   *  there asks {@link CollectionFold} instead — that IS the batched path's change
   *  channel, and a richer one, since it hands over the wire's whole frame. */
  byKey: (key: K) => Subscription<T> | undefined;
}

export function useCollection<Name extends string, K, T, I>(
  collDescriptor: Collection<Name, K, T>,
  options: UseCollectionOptions<K, T, I>,
): UseCollectionResult<K, T> {
  const keys = createMemo<K[]>(() => options.keys());

  // Keep the per-key subscriptions out of existence until the first lookup, and
  // give each requested key its own equality gate: membership changes cannot
  // wake unrelated key readers.
  //
  // `mapArray` is BUILT on that first lookup rather than here, because a Solid 2
  // computed is EAGER — `setupComputedNode` recomputes at creation unless it is
  // declared lazy (`@solidjs/signals` 2.0.4 `dist/dev-shared.js`), and `mapArray`
  // declares an ordinary one. Built at construction it would walk the key set and
  // open one upstream subscription per key before any consumer named one, which
  // is exactly the laziness this receptacle promises (a whole-collection view a
  // component takes but never reads costs nothing). The view's owner is captured
  // so the deferred build still lands HERE, not on whichever reactive scope
  // happens to look up first.
  //
  // That capture is also this view's whole lifetime: every per-key subscription
  // is opened under it and dies with it, and this hook exposes no `signal`, so
  // an ownerless call is refused at birth — in the consumer's own spelling, not
  // the shared seam's, which names a primitive this caller never called and
  // offers a `signal` it has no way to pass. Refusing here rather than at the
  // first `byKey` also keeps the deferral honest — a view nobody looks up still
  // has no lifetime.
  const owner = getOwner();
  if (!owner)
    throw noLifetimeRefusal({
      name: "`.collections.X.use()` (useCollection)",
      acceptsSignal: false,
    });
  const lookups = new Map<K, Accessor<Subscription<T> | undefined>>();
  let index: Accessor<Map<K, Subscription<T>>> | undefined;
  function byKey(key: K): Subscription<T> | undefined {
    let read = lookups.get(key);
    if (!read) {
      read = runWithOwner(owner, () => {
        if (!index) {
          // mapArray creates a reactive owner per key, and each per-key
          // subscription opens its fiber in THAT owner's effect phase. When a key
          // leaves, the owner is disposed → the effect's returned cleanup
          // interrupts the fiber → the stream's finalizers close the server
          // subscription. No manual teardown.
          const perKey = mapArray(keys, (key) => {
            const sub = createSubscription(
              unenrolledStreamCall(
                options.valueSource,
                options.keyToInput(key),
                {
                  // The `client.health()` per-key spelling (`<key>[<id>]`), reused
                  // rather than re-spelled, so the liveness registry and the health
                  // fact name one subscription one way (kolu#2101 J2).
                  label: `${collDescriptor.name}[${String(key)}]`,
                },
              ),
              // The member's DECLARED array identity, off the descriptor — this
              // path merges an entry's value through the same seam a cell's goes
              // through, so it honours the declaration the same way. (The batched
              // `deltas` path merges each named entry too, under the same
              // declaration; see `CollectionSpec.arrayKey`.)
              { onError: options.onError, arrayKey: collDescriptor.arrayKey },
            );
            // Enrol this per-key sub into the client health registry (when
            // wired). Runs in the per-key owner, so the registry's `onCleanup`
            // drop fires on the same disposal that tears the subscription down
            // when this key leaves the set.
            options.enroll?.(key, sub);
            return { key, sub };
          });
          index = createMemo(
            () => {
              const table = new Map<K, Subscription<T>>();
              for (const entry of perKey())
                if (!table.has(entry.key)) table.set(entry.key, entry.sub);
              return table;
            },
            { name: `${collDescriptor.name}.index` },
          );
        }
        const table = index;
        return createMemo(() => table().get(key), {
          name: `${collDescriptor.name}[${String(key)}]`,
        });
      });
      if (!read)
        throw new Error("Collection lookup owner failed to initialize");
      lookups.set(key, read);
    }
    return read();
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
   *  snapshot, and the seeding a fold registered mid-stream is given. Entries are
   *  the CLIENT STORE's own values in its arrival order — the same objects `byKey`
   *  reads — for all three, so what `init` receives never depends on WHEN this fold
   *  registered. */
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
  /** Re-initialize from a full-set frame — always the one rebuilt from the held
   *  store, whether the wire delivered a snapshot or this fold registered
   *  mid-stream. */
  readonly seed: (entries: ReadonlyArray<readonly [K, T]>) => void;
  /** Apply one delta frame. A no-op while this fold has no valid accumulator — a
   *  delta has nothing to land on until a snapshot has built one. */
  readonly step: (delta: CollectionDelta<K, T>) => void;
}

/** Membership-and-position equality for the arrival-order key list, asked at the ONE
 *  writer that can produce an unchanged one: a reconnect snapshot naming the same
 *  set. The delta arm never asks, because it only writes `order` once it has already
 *  established that membership moved — an `equals` on the signal itself would put
 *  this walk on that path too, to answer a question it just answered. */
function sameOrder<K>(a: readonly K[], b: readonly K[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

export function useCollectionDeltas<Name extends string, K, T>(
  coll: Collection<Name, K, T>,
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
  // This view's whole lifetime is the caller's owner: the batched fiber is opened
  // under it and dies with it, and this hook exposes no `signal`, so an ownerless
  // call has no lifetime at all and is refused at birth — before a store, a fold
  // registry or an effect exists. Worded in the consumer's own spelling, not the
  // shared seam's, which names a primitive this caller never called and offers a
  // `signal` it has no way to pass.
  if (!getOwner())
    throw noLifetimeRefusal({
      name: "`.collections.X.use()` (useCollectionDeltas)",
      acceptsSignal: false,
    });
  // THE store, owned here rather than reached through `createSubscription`'s generic
  // reduce: a frame NAMES the keys it touches, and the whole point of this path is to
  // write exactly those. Routing through the reduce path meant a fresh accumulator per
  // frame (a whole-dict copy) which `reconcile` then walked in full to rediscover the
  // keys the frame had already named — two O(N) passes per O(|frame|) update.
  const [dict, setDict] = createStore<Record<string, T>>(emptyDict<T>());
  // The PLAIN mirror of what the store holds, maintained key-for-key beside it by
  // the two apply functions below — the dictionary twin of `heldOrder`, and for
  // the same two reasons. A store's backing is COPY-ON-WRITE (a draft write clones
  // the container it writes into, `@solidjs/signals` 2.0.4 `dist/dev.js`
  // `cloneRaw`), so a `snapshot(dict)` taken once goes stale at the first write and
  // one taken per frame copies the whole dictionary — O(N) per O(|frame|) update,
  // which is the cost this path exists to avoid. Every read inside the frame loop
  // goes through this instead: the loop is deciding what to write, not rendering.
  const held: Record<string, T> = emptyDict<T>();
  // The arrival-order key list. A plain signal: the frame loop is the only writer,
  // and `createStreamLifecycle` opens the fiber from the EFFECT PHASE, so no frame
  // — not even one a fiber has ready before its first async boundary — is ever
  // applied inside the scope that created this view. Nothing here writes reactive
  // state in an owned scope, so no `ownedWrite` is needed on this or on the store.
  const [order, setOrder] = createSignal<K[]>([]);

  const folds = new Set<FoldSlot<K, T>>();
  /** Whether a full-set frame has been applied — i.e. whether the held store is a
   *  state a fold can be seeded from, and whether a delta has a base to land on. */
  let seeded = false;
  /** How many entries the dictionary holds. Tracked as frames are applied so
   *  {@link assertKeysInjective} costs O(1) rather than a walk over every key. */
  let size = 0;

  /** The CURRENT key list, held beside the signal rather than read back out of it:
   *  a signal write lands on the next flush, and a fiber can deliver several frames
   *  inside one synchronous turn, so reading `order()` back would rebuild the second
   *  frame's list from the one the first frame replaced. This is the list; the
   *  signal is its reactive MIRROR, and {@link keys} is the pair's one reader. */
  let heldOrder: K[] = [];
  const writeOrder = (next: K[]): void => {
    heldOrder = next;
    setOrder(next);
  };
  /** The key set, as every consumer and every fold reads it: SUBSCRIBE to the
   *  mirror, ANSWER from the authority — the rule for every plain-authority +
   *  reactive-mirror pair (`scrollLock`'s lock, `connectSurfaces`'s connection
   *  state). Both are moved by `writeOrder` alone and the signal is handed the
   *  very array `heldOrder` holds, so the two can differ only in WHEN: between a
   *  frame and its flush the signal still reads the previous list, and a reader
   *  inside that window — a fold `step`, which the frame loop calls there —
   *  would otherwise be told the set from before the frame it is being handed. */
  const keys: Accessor<K[]> = () => {
    order();
    return heldOrder;
  };

  /** Apply a FULL-SET frame. O(N), which is inherent — the frame carries N entries.
   *
   *  VALUE-diffed, not reference-diffed, and that is load-bearing: the retry fence
   *  turns a transport drop into a fresh snapshot rather than an error, so a
   *  reconnect re-serializes the same content into fresh objects. An entry whose
   *  value is unchanged must therefore NOT re-notify its readers — a link flap is
   *  deliberately a visual no-op. An entry that DID change is MERGED into the
   *  entry standing there ({@link writeEntryValue}), so only the leaves that
   *  actually moved wake their readers; the object a fold may be holding is not
   *  written through either way, because a merge ADOPTS the incoming frame rather
   *  than mutating what it replaces. */
  function applySnapshot(entries: ReadonlyArray<readonly [K, T]>): void {
    const present = new Set<string>();
    const nextOrder: K[] = [];
    for (const [k] of entries) {
      assertFoldableKey(k);
      present.add(String(k));
      nextOrder.push(k);
    }
    assertKeysInjective(present.size, nextOrder.length);
    setDict((d) => {
      for (const sk of Object.keys(held)) {
        if (!present.has(sk)) {
          delete d[sk];
          delete held[sk];
        }
      }
      for (const [k, v] of entries) {
        const sk = String(k);
        // Membership and the value to diff against BOTH come from the mirror, so
        // neither question walks the draft: a read through it would mint a
        // mutation proxy for every object it touches, and the comparison walks
        // the whole value. Only an entry that survives the diff is then read
        // through the draft, by the merge that writes it.
        if (!(sk in held) || !framesEqual(held[sk], v)) {
          writeEntryValue(d, sk, held[sk], v, coll.arrayKey);
          held[sk] = v;
        }
      }
    });
    size = present.size;
    // A reconnect that names the same set keeps the previous array BY REFERENCE, so
    // `keys()` stays quiet through a link flap — the "order by reference" rule.
    if (!sameOrder(heldOrder, nextOrder)) writeOrder(nextOrder);
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
   *  moved. Unconditional is about the KEY, not about its leaves: the write is the
   *  merge below, which notifies the leaves the two frames disagree on. */
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
    setDict((d) => {
      // A MERGE per named key ({@link writeEntryValue}), not a wholesale
      // replacement of the entry: the store tracks leaves, so replacing the
      // container would wake every reader under that key for the one field a
      // delta moved — and a record whose title ticks would re-run the readers of
      // its git facts. The frame object a fold may be holding stays frozen under
      // the merge: `reconcile` adopts the incoming frame by pointer swap and
      // never writes through what stood there (§ the aliasing contract, argued in
      // `./writeValue.ts`). Membership and the merge's previous value are asked
      // of the mirror, which is the same key set — and the same backing objects —
      // the draft holds, and costs no trap.
      for (const [k, v] of delta.upserts) {
        const sk = String(k);
        if (!(sk in held)) net++;
        writeEntryValue(d, sk, held[sk], v, coll.arrayKey);
        held[sk] = v;
      }
      for (const k of delta.removes) {
        const sk = String(k);
        if (!(sk in held)) continue; // absent, or already removed by this same frame
        delete d[sk];
        delete held[sk];
        net--;
        removed.push(k);
      }
    });
    size += net;
    // Key set UNCHANGED (a pure value-update tick) → nothing to write; the order
    // signal keeps its array BY REFERENCE and `keys()` stays quiet.
    if (added.length === 0 && removed.length === 0) return;
    // Rebuild only when membership moved. `Set(removed)` is sized to the (small)
    // removal set, never to the whole collection.
    let nextOrder: K[];
    if (removed.length > 0) {
      const gone = new Set<K>(removed);
      nextOrder = heldOrder.filter((k) => !gone.has(k));
    } else {
      nextOrder = heldOrder.slice();
    }
    for (const k of added) nextOrder.push(k);
    assertKeysInjective(size, nextOrder.length);
    writeOrder(nextOrder);
  }

  /** The full-set frame EVERY fold is seeded with — the wire's snapshot arm and a
   *  mid-stream registration alike — rebuilt from the held store.
   *
   *  REBUILT rather than passed through, and that is the whole of it: the keyed cache
   *  shares ONE slot per collection, so a late fold cannot be handed the wire's own
   *  snapshot back; and {@link applySnapshot} is VALUE-diffed, so an entry the wire
   *  re-serialized unchanged keeps the object the store already held and the wire's
   *  fresh copy is dropped on the floor. Seeding from `msg.entries` would therefore
   *  hand a fold objects the store itself refused, and make what `init` receives
   *  depend on WHEN the fold registered — the store's values when late, the wire's
   *  when alive across a reconnect. One answer instead: a fold is seeded with what
   *  `byKey` reads, whichever frame put it there.
   *
   *  Costs N pairs on a path that is already O(N) in the frame it just applied, and
   *  only when a fold is registered at all. */
  function syntheticSnapshot(): [K, T][] {
    return heldOrder.map((k) => {
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

  /** Run `notify` inside a DRAFT WINDOW on the dictionary store — the frame
   *  loop's seam for handing consumer code the frame it just applied.
   *
   *  A store serves a context-free reader the COMMITTED backing until the flush
   *  ("it mutates at exactly one moment — the flush's commit",
   *  `@solidjs/signals` 2.0.4 `dist/dev.js` :3744), which is why a fold `step`
   *  reading `byKey` straight after {@link applyDelta} would see the previous
   *  frame. Inside a setter the same read is served the STAGING instead
   *  (`readSource` :5001: `inDraft` ⇒ the pending backing; `inDraft` :4938 is
   *  per store FAMILY, so the public proxy answers from the staging exactly as
   *  the draft does, and hands back the very proxy it serves afterwards).
   *
   *  The window WRITES nothing: opening it is its whole job. `held`, `heldOrder`
   *  and `size` are already this frame's by the time it opens, so every way a
   *  fold can ask — the frame argument, `byKey`, `keys()`,
   *  {@link syntheticSnapshot} — answers with the same frame. A frame with no
   *  registered fold opens no window: the setter call is the cost, and there is
   *  nothing to tell.
   *
   *  It is a `setDict` call, so it carries that call's owned-scope refusal; the
   *  frame loop runs on the subscription's fiber, never in an owned scope (which
   *  is why registration-time seeding — in the CALLER's scope — opens no window
   *  and needs none: nothing is staged there). */
  function inFrameDraft(notify: () => void): void {
    setDict(() => {
      notify();
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
      // Assert keys → apply to the store → notify the folds, the last of them
      // inside the frame's own store transaction. No reader ever observes a
      // half-applied frame: the write is ONE staged transaction that lands
      // whole on the flush, and `pending` clears after it.
      //
      // The folds are notified through {@link inFrameDraft}, so a `step` that
      // reads `byKey` sees the frame it is applying rather than the one before
      // it — the same frame `keys()` answers with and the same one a SEEDED
      // fold is handed through {@link syntheticSnapshot}. One frame, one
      // answer, whichever way a fold asks for it.
      onFrame: (msg) => {
        if (msg.kind === "snapshot") {
          applySnapshot(msg.entries);
          seeded = true;
          // A snapshot RE-INITIALIZES every registered fold. The consumer never
          // distinguishes first-connect from reconnect; both are "here is the whole
          // set". From {@link syntheticSnapshot}, never from `msg.entries` — the store
          // is the ONE answer to "what is a fold seeded with", so a fold alive across
          // a reconnect and one registering a moment later are handed the same
          // objects. Iterated over a COPY: a `seed`/`step` that registers another fold
          // has already had it seeded by `fold()` itself, and a live `Set` walk would
          // visit the newcomer and seed it twice. That copy also answers whether
          // rebuilding the frame is worth anything — no folds, nothing to rebuild it
          // for.
          const registered = [...folds];
          if (registered.length > 0) {
            const entries = syntheticSnapshot();
            inFrameDraft(() => {
              for (const slot of registered) slot.seed(entries);
            });
          }
        } else {
          applyDelta(msg);
          const registered = [...folds];
          if (registered.length > 0) {
            inFrameDraft(() => {
              for (const slot of registered) slot.step(msg);
            });
          }
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
    // ONE holder for the accumulator: `acc` below IS it, and the accessor reads it
    // through a pulse signal. `undefined` reads as "there is no valid
    // accumulator" and means nothing else, so a second seeded/unseeded flag beside
    // it would be a duplicate that could disagree with what the consumer sees.
    //
    // HELD in a plain variable rather than in the signal for two reasons: a signal
    // write lands on the next flush, so a `step` reading its own base back out of a
    // signal would fold the second frame of a synchronous turn onto the base the
    // first frame replaced; and registration seeds from the CALLING scope, where a
    // signal write would be a write inside an owned scope.
    //
    // The pulse carries no value — `equals: false` is the whole of it: the
    // framework cannot know whether `A` is a value or an accumulator the consumer
    // mutates and returns, so it must never decide that a frame changed nothing. A
    // spurious wake is harmless; a swallowed update is the bug.
    let acc: { value: A } | undefined;
    const [pulse, firePulse] = createSignal<undefined>(undefined, {
      equals: false,
    });
    const value: Accessor<A | undefined> = () => {
      pulse();
      return acc?.value;
    };
    // A throwing `init`/`step` is contained PER FOLD and reported loudly — it must
    // never kill the stream, the store, or another fold. The accumulator is
    // INVALIDATED: applying later deltas onto a base that failed to build is how a
    // fold goes silently wrong, so the accessor goes back to `undefined` — where it
    // started, and where the next snapshot re-seeds it from.
    const rebuild = (what: string, compute: () => A): void => {
      let next: { value: A } | undefined;
      containThrow(
        `a collection fold's \`${what}\``,
        () => {
          next = { value: compute() };
        },
        "the stream, the store and every other fold keep flowing; this fold's accumulator is invalidated until the next snapshot re-seeds it",
      );
      acc = next;
    };
    /** Rebuild AND notify — the frame loop's entry point. */
    const guard = (what: string, compute: () => A): void => {
      rebuild(what, compute);
      firePulse(undefined);
    };
    const slot: FoldSlot<K, T> = {
      seed: (entries) => guard("init", () => foldOptions.init(entries)),
      step: (delta) => {
        const base = acc?.value;
        if (base === undefined) return;
        guard("step", () => foldOptions.step(base, delta));
      },
    };
    folds.add(slot);
    onCleanup(() => {
      folds.delete(slot);
    });
    // Seeding AT REGISTRATION rebuilds without notifying: no consumer can be
    // reading this fold yet, and the caller's scope is an owned one.
    if (seeded) rebuild("init", () => foldOptions.init(syntheticSnapshot()));
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
    // scope tracks only that leaf. Called from inside the frame's draft window
    // ({@link inFrameDraft}, i.e. from a fold's `init`/`step`), the same read is
    // served the frame being applied instead of the last flushed one, and the
    // proxy it hands back is the one every other reader gets after the flush.
    // `error`/`pending`/`complete` are the single stream's, shared across keys.
    const read = (() => dict[sk]) as Subscription<T>;
    return Object.assign(read, state);
  }

  return { keys, byKey, fold, stream: state };
}
