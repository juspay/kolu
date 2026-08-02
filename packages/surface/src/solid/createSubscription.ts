/**
 * SolidJS primitive for consuming Effect streams as reactive signals.
 *
 * `createSubscription()` — `Stream<T>` → SolidJS Accessor
 *
 * **The Effect↔Solid edge (PLAN D10).** This is a SANCTIONED `Effect.runFork`
 * boundary, and one of very few: SolidJS's reactive graph is push-based and
 * synchronous, so a stream has to be *run* somewhere for its frames to become
 * signal writes. The fiber is SCOPED — it is interrupted by the subscription's own
 * teardown (the caller's `onCleanup`, or an external `signal`), and interruption
 * propagates into the stream's finalizers, which is what closes the wire
 * subscription. There is no abort signal to thread and none to forget: cancellation
 * IS interruption.
 *
 * The stream handed in is expected to already carry the framework's retry fence
 * (`unenrolledStreamCall` / the bound `.use()` hooks apply it), so a transport drop
 * never reaches this loop as an error — it reaches it as a fresh snapshot, which is
 * exactly what the change-iff-fired law below is written against.
 *
 * For mutations, call the server directly (a unary member call returns a Promise).
 * If you need loading/error tracking for a mutation, use SolidJS's `createResource`.
 */

import type { Stream } from "effect";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { runStreamScoped } from "../runStream";
import { writeWrappedValue } from "./writeValue";

/** A teardown handle — call to unsubscribe. */
export type Dispose = () => void;

/** A value change on a cell subscription: the value BEFORE this frame and the
 *  value AFTER. Delivered by {@link Subscription.updated}. */
export interface CellChange<T> {
  readonly prev: T;
  readonly next: T;
}

/**
 * A SolidJS Accessor backed by a server stream.
 *
 * Extends `Accessor<T | undefined>` — calling it is a real SolidJS
 * reactive read, just like any signal from `createSignal`. Additional
 * properties for error and pending follow the same pattern as
 * SolidJS's `createResource`.
 */
export interface Subscription<T> extends Accessor<T | undefined> {
  /** Stream error (undefined when healthy). */
  readonly error: Accessor<Error | undefined>;
  /** True while waiting for the first event from the stream. */
  readonly pending: Accessor<boolean>;
  /** Subscribe to CHANGES — the missing half of an FRP `Dynamic`. Fires under
   *  the **change-iff-fired** law:
   *
   *    - a FIRST frame is a value, not a change — it never fires (learning the
   *      current truth is not news that something happened);
   *    - a reconnect snapshot EQUAL to the last-seen value never fires (a link
   *      flap replaying current truth changed nothing);
   *    - a frame that DIFFERS fires exactly once, with `prev` = the last-seen
   *      value.
   *
   *  Equality is by value (a reconnect re-serializes the same content into a
   *  fresh object), matching the producer's own equals-dedup on deltas — so a
   *  consumer that needs "what changed" gets honest `{prev, next}` pairs without
   *  hand-holding a previous frame or classifying reconnect snapshots. A handler
   *  added mid-stream sees only changes from that point on (read the accessor for
   *  "what is"). Returns a `Dispose` to unsubscribe.
   *
   *  Optional for the same reason as `complete`: a hand-assembled
   *  `Subscription`-shaped value need not provide it; every subscription minted
   *  by this module's factories does. */
  readonly updated?: (handler: (change: CellChange<T>) => void) => Dispose;
  /** True once the stream has ENDED NORMALLY (a typed end — never on abort).
   *  Latches permanently: once true, this subscription's value is FROZEN —
   *  it will never update again. Without this fact, an ended subscription
   *  reads byte-identical to a healthy, currently-streaming one (no error, not
   *  pending), so a consumer that holds onto a `Subscription` across a typed
   *  end (e.g. one sharing slot behind the keyed cache, evicted for LATER
   *  callers but still referenced by an earlier one) has no way to tell its
   *  last-read value is stale-forever rather than current. Check this before
   *  trusting `value()` as "live".
   *
   *  Optional (not every `Subscription`-shaped value is minted by
   *  `createSubscription`/`createReactiveSubscription` — a hand-assembled one
   *  built directly over `{ pending, error }`, predating this fact, has no
   *  typed-end concept to report and legitimately omits it); every subscription
   *  built through THIS module's factories always populates it. */
  readonly complete?: Accessor<boolean>;
}

/** Options for createSubscription. */
export interface SubscriptionOptions<T, R = T> {
  /**
   * Reducer for accumulating stream items.
   * When provided, each item is folded into the accumulator.
   * Without a reducer, each item replaces the previous value.
   */
  reduce?: (accumulator: R, item: T) => R;
  /** Initial value for the accumulator (required when using reduce). */
  initial?: R;
  /**
   * External abort signal for imperative lifecycle management.
   * When provided, used instead of `onCleanup` — allows creating
   * subscriptions outside a reactive owner (e.g. dynamic per-entity maps).
   *
   * An `AbortSignal` and not a fiber/scope because the CALLERS are non-Effect
   * (a Solid map keyed by entity id, a DOM lifecycle): it is the edge's own
   * cancellation vocabulary, translated here into the one fiber interrupt.
   */
  signal?: AbortSignal;
  /** Called when the stream errors. Use to surface failures to the user
   *  (e.g. `toast.error`). Without this, stream errors are only available
   *  via the reactive `sub.error()` signal — easy to forget to read. */
  onError?: (err: Error) => void;
  /** Called when the stream ENDS NORMALLY — the async iterable completed because
   *  the server/map sent a typed end — NEVER on abort. The keyed subscription cache
   *  wires this to evict a shared slot on typed completion, so a re-added member
   *  never reuses an ended stream. "A disposed subscription cannot report anything"
   *  extends here: an aborted subscription must not fire `onComplete`. */
  onComplete?: () => void;
}

/** Structural value equality for subscription frames — the change-iff-fired law's
 *  "equal reconnect snapshot never fires" needs VALUE equality, since a reconnect
 *  re-serializes the same content into a fresh object (reference equality would
 *  misread it as a change).
 *
 *  **Conservative by construction: it NEVER yields a false-positive that hides a
 *  real change.** The subscription primitives are generic over arbitrary
 *  `Stream<T>` (and the in-process `directDispatch` passes values through WITHOUT
 *  serialization, and Effect Schema admits `Date`/`Map`/`Set`), so a frame is not
 *  guaranteed to be JSON-shaped — nor acyclic. Rather than a naive plain-object walk
 *  that would read two distinct `Date`s (or symbol-keyed objects) as equal and
 *  SUPPRESS a real `updated`, this handles the common cases exactly — primitives,
 *  arrays, plain objects, `Date` (by time), `Map`/`Set` — and returns `false` for
 *  anything it cannot prove equal (class instances, `RegExp`, typed arrays,
 *  symbol-keyed own props). A false-negative only fires a spurious `updated` with
 *  `prev ≈ next` (harmless); a false-positive would drop a change (the bug).
 *
 *  Own-property comparison uses `Object.getOwnPropertyNames` (not `Object.keys`), so
 *  a NON-ENUMERABLE own prop, an AUGMENTED array (`arr.foo = 1`), and a SPARSE array
 *  (holes are absent from the name set, so `[,,]` ≠ `[undefined, undefined]`) are all
 *  compared, never silently ignored. A path-scoped `Pairing` breaks CYCLES *by
 *  topology*: a frame that loops back compares equal at the back-edge only when it
 *  closes to the SAME counterpart on the OTHER side — so a self-cycle (`a.self === a`)
 *  and a child-cycle (`b.self` points elsewhere) DIVERGE here instead of reading
 *  equal, never suppressing a real change a consumer could observe via `x.self === x`.
 *  Not exported: it is the private frame comparator for {@link Subscription.updated}
 *  and its reactive twin.
 *
 *  Why hand-rolled and not `dequal` / `fast-deep-equal` (both already in the
 *  lockfile): a deep-equal here MUST be cycle-safe (a `directDispatch` frame can be
 *  cyclic) AND never false-positive (a false-positive DROPS a real change — the
 *  bug). `dequal` and `fast-deep-equal` recurse without cycle tracking, so a
 *  cyclic frame stack-overflows rather than compares — the exact case this
 *  comparator's path-scoped `Pairing` is built for. The narrow, verifiable "prove
 *  equal or return false" contract is the point; a general library that can't
 *  make that guarantee is the wrong tool, not a missing dependency. */
function framesEqual(a: unknown, b: unknown): boolean {
  return framesEqualOnPath(a, b, { aToB: new Map(), bToA: new Map() });
}

/** Path-scoped correspondence between the two graphs' objects currently on the
 *  traversal stack. A revisited object closes a cycle: it is consistent only when it
 *  maps to the counterpart it was first paired with (both directions), so different
 *  cyclic topologies compare unequal rather than short-circuiting to `true`. Entries
 *  are added on descent and deleted on unwind, so a DAG's shared subobject is still
 *  compared fresh on each separate branch. */
interface Pairing {
  aToB: Map<unknown, unknown>;
  bToA: Map<unknown, unknown>;
}

function framesEqualOnPath(a: unknown, b: unknown, pairing: Pairing): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  // Date — compare by instant. Only one being a Date ⇒ not equal. (Non-recursive:
  // checked before the cycle guard, never added to the path.)
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  // Cycle guard: if either side is already on THIS path, the structure loops back.
  // The back-edge is equal ONLY when it closes to the corresponding counterpart on
  // both sides (`a` was paired with exactly `b` before) — otherwise the two graphs
  // have different cyclic topology and must compare unequal. Comparing only "seen a
  // node before" would read a self-cycle equal to a child-cycle and SUPPRESS a real
  // change. Path-scoped (deleted on unwind) so a DAG's shared subobject compares
  // fresh on each branch.
  if (pairing.aToB.has(a) || pairing.bToA.has(b)) {
    return pairing.aToB.get(a) === b && pairing.bToA.get(b) === a;
  }
  pairing.aToB.set(a, b);
  pairing.bToA.set(b, a);
  try {
    const aArr = Array.isArray(a);
    if (aArr !== Array.isArray(b)) return false;
    // Set — same size and every member present in both. Object members compare by
    // identity via `has` (conservative: distinct-but-equal object members read as a
    // change, never suppress one).
    if (a instanceof Set || b instanceof Set) {
      if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) {
        return false;
      }
      for (const v of a) if (!b.has(v)) return false;
      return true;
    }
    // Map — same size and every key's value equal (keys by identity via `has`).
    if (a instanceof Map || b instanceof Map) {
      if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) {
        return false;
      }
      for (const [k, v] of a) {
        if (!b.has(k) || !framesEqualOnPath(v, b.get(k), pairing)) {
          return false;
        }
      }
      return true;
    }
    // Plain objects and arrays. A non-plain, non-array prototype (class instance,
    // RegExp, typed array, …) is treated as CHANGED — never claim an equality we
    // can't prove, so a real change is never suppressed. Any own SYMBOL key likewise
    // forces `false`: `getOwnPropertyNames` can't see symbol keys, so two objects
    // differing only in a symbol-keyed value would otherwise read equal.
    if (!aArr) {
      const protoA = Object.getPrototypeOf(a);
      if (protoA !== Object.prototype && protoA !== null) return false;
      const protoB = Object.getPrototypeOf(b);
      if (protoB !== Object.prototype && protoB !== null) return false;
    }
    if (
      Object.getOwnPropertySymbols(a).length > 0 ||
      Object.getOwnPropertySymbols(b).length > 0
    ) {
      return false;
    }
    // Full own-string-key set (enumerable AND non-enumerable). For arrays this
    // includes `length`, every present index (holes are absent ⇒ sparse ≠ dense),
    // and any augmenting prop — so nothing is silently ignored.
    const aObj = a as Record<PropertyKey, unknown>;
    const bObj = b as Record<PropertyKey, unknown>;
    const aKeys = Object.getOwnPropertyNames(aObj);
    if (aKeys.length !== Object.getOwnPropertyNames(bObj).length) return false;
    for (const k of aKeys) {
      if (!Object.hasOwn(bObj, k)) return false;
      if (!framesEqualOnPath(aObj[k], bObj[k], pairing)) return false;
    }
    return true;
  } finally {
    pairing.aToB.delete(a);
    pairing.bToA.delete(b);
  }
}

/** The change-iff-fired half of the Dynamic, as a standalone tracker so BOTH
 *  subscription factories share ONE implementation of the law (only the value
 *  type differs). `lastSeen` is tracked from the very first frame — independent
 *  of whether any handler is registered — so "a first frame never fires" holds
 *  no matter when a consumer subscribes.
 *
 *   - `noteFrame(next)` — call on every stream frame (before the store write):
 *     the first frame seeds `lastSeen` silently; an equal frame (a reconnect
 *     snapshot) is silent; a differing frame fans out one `{prev, next}` change.
 *   - `reset()` — a fresh subscription (the reactive factory's input change)
 *     re-arms the first-frame rule; handlers survive (they belong to the caller).
 *   - `updated(handler)` — subscribe; returns a `Dispose`. */
export function createUpdatedTracker<V>(): {
  noteFrame: (next: V) => void;
  updated: (handler: (change: CellChange<V>) => void) => Dispose;
  reset: () => void;
} {
  const handlers = new Set<(change: CellChange<V>) => void>();
  // A discriminated union, not `{ has, value }`: there is no "unseen with a
  // value" state to represent, and the unseen arm carries no `V` — so nothing
  // manufactures an arbitrary `undefined as V` to satisfy the type.
  let lastSeen: { kind: "unseen" } | { kind: "seen"; value: V } = {
    kind: "unseen",
  };
  return {
    noteFrame(next) {
      if (lastSeen.kind === "unseen") {
        lastSeen = { kind: "seen", value: next }; // first frame: a value, not a change
        return;
      }
      // Hot-path short-circuit: with no handler registered, the baseline just
      // advances to the latest frame in O(1) — a handler added later sees only
      // changes FROM that point on, so it never needs the intervening compares.
      // This keeps the deep `framesEqual` off every cell/stream/collection frame
      // for the overwhelmingly common no-`updated`-handler case.
      if (handlers.size === 0) {
        lastSeen = { kind: "seen", value: next };
        return;
      }
      if (framesEqual(lastSeen.value, next)) return; // equal reconnect snapshot: silent
      const prev = lastSeen.value;
      lastSeen = { kind: "seen", value: next };
      // Hand consumers a SNAPSHOT: the store writes these frames through Solid's
      // `reconcile`, which adopts a frame and mutates it on the next write — a
      // retained `{prev, next}` would silently mutate out from under the
      // consumer. Clone only on a firing change with subscribers, so the hot
      // no-op path pays nothing. (`framesEqual` above ran on the pre-write
      // values, so the baseline compare is unaffected by the mutation.)
      const change: CellChange<V> = {
        prev: structuredClone(prev),
        next: structuredClone(next),
      };
      // Guard each handler: one consumer's throwing `updated` callback must not
      // abort fan-out to the others, and — critically for a SHARED subscription
      // behind the keyed cache — must not escape into the stream-consume `catch`,
      // where it would be misreported as an upstream stream error and terminate
      // the iterator for EVERY cached consumer. Report loudly, keep going.
      for (const h of [...handlers]) {
        try {
          h(change);
        } catch (err) {
          console.error("subscription `updated` handler threw", err);
        }
      }
    },
    updated(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    reset() {
      lastSeen = { kind: "unseen" };
    },
  };
}

/** Convert an Effect `Stream` into a SolidJS signal.
 *
 *  `source` is LAZY and is run on a scoped fiber owned by this subscription (see
 *  `./runStream`). Disposing the subscription — the caller's `onCleanup`, or the
 *  external `options.signal` — INTERRUPTS that fiber, and interruption runs the
 *  stream's own finalizers, which is what cancels the wire subscription. Without
 *  that, teardown would only stop READING the stream while the server-side
 *  subscription (and its bounded frame queue) stayed open until the stream happened
 *  to end on its own — forever, for a quiet cell that never publishes again.
 *
 *  Hand in a stream that already carries the retry fence
 *  (`unenrolledStreamCall`, or one of the bound `.use()` hooks): a transport drop
 *  must reach this loop as a fresh SNAPSHOT, never as an `error()`. */
export function createSubscription<T>(
  source: Stream.Stream<T, unknown>,
): Subscription<T>;
export function createSubscription<T>(
  source: Stream.Stream<T, unknown>,
  options: Omit<SubscriptionOptions<T>, "reduce" | "initial">,
): Subscription<T>;
export function createSubscription<T, R>(
  source: Stream.Stream<T, unknown>,
  options: SubscriptionOptions<T, R> & { initial: R },
): Subscription<R>;
export function createSubscription<T, R = T>(
  source: Stream.Stream<T, unknown>,
  options?: SubscriptionOptions<T, R>,
): Subscription<T | R> {
  const reduce = options?.reduce as
    | ((acc: T | R, item: T) => T | R)
    | undefined;
  const initial = options?.initial;

  if (reduce && initial === undefined) {
    throw new Error(
      "createSubscription: 'initial' is required when using 'reduce'",
    );
  }

  // Internal state as a store for fine-grained reactivity on object values.
  // The store wraps the value in { v: T } so reconcile works on any T shape.
  const [store, setStore] = createStore<{ v: T | R | undefined }>({
    v: initial,
  });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);

  function updateValue(next: T | R): void {
    writeWrappedValue(setStore, next as T | R | undefined);
  }

  // The change-iff-fired half of the Dynamic — the ONE law shared with
  // `createReactiveSubscription` via `createUpdatedTracker`.
  const tracker = createUpdatedTracker<T | R>();

  // Run the stream on this subscription's own scoped fiber. `runStreamScoped`
  // owns the "a disposed subscription reports nothing" rule, so nothing below
  // re-checks an aborted flag.
  const stop = runStreamScoped<T>(source, {
    onFrame: (item) => {
      const next = reduce ? reduce(store.v as T | R, item) : (item as T | R);
      tracker.noteFrame(next); // fire `updated` on a genuine change, before the write
      updateValue(next);
      if (pending()) setPending(false);
      // NOT "clear a stale error here". A failure is the FIBER'S EXIT, so no frame
      // can follow one on the same subscription — an `error()` is terminal for this
      // stream, and a clear-on-next-frame branch would be dead code implying a
      // recovery that cannot happen. What actually keeps `error()` from LATCHING is
      // one layer up: the retry fence re-subscribes transparently, so a transport
      // drop never lands here at all. What DOES land is a declared (D4) failure,
      // and terminal is the honest reading of it — the stream is over.
    },
    // A TYPED end (the server/map completed the stream), never an interruption.
    // Clear any lingering `pending` and latch `complete` so the dedup cache can
    // evict this slot and a re-added member never reuses an ended stream.
    onEnd: () => {
      if (pending()) setPending(false);
      setComplete(true);
      options?.onComplete?.();
    },
    onFailure: (err) => {
      setError(err);
      if (pending()) setPending(false);
    },
  });

  // Single cleanup path: external signal OR `onCleanup`. Never both — avoids dual
  // lifecycle braiding. The external-signal arm is what lets a subscription be
  // created outside a reactive owner (a dynamic per-entity map).
  if (options?.signal) {
    if (options.signal.aborted) stop();
    else options.signal.addEventListener("abort", stop, { once: true });
  } else {
    onCleanup(stop);
  }

  const sub = Object.assign(() => store.v as (T | R) | undefined, {
    error,
    pending,
    complete,
    updated: tracker.updated,
  }) as Subscription<T | R>;

  if (options?.onError) {
    wireSubscriptionError(sub, options.onError);
  }

  return sub;
}

/** Wire a per-consumer error handler onto a subscription's `error()` signal, via an
 *  EDGE effect — fires once per rising error transition and tracks the signal, so
 *  the callback and the signal can never disagree about whether this subscription is
 *  failed (never the inline-at-the-failure-site double-fire, and never a handler
 *  latched on a failure a slot rebuild has since cleared). Factored out of `createSubscription`
 *  so the keyed subscription cache can share ONE upstream subscription across N
 *  consumers while each consumer still gets its OWN `onError` (a per-call label /
 *  toast), wired under that consumer's own reactive owner.
 *
 *  Takes only `{ error }` (not the whole `Subscription<T>`) — the one field this
 *  reads — so a shared, ALREADY-DESTRUCTURED result (e.g. a read-only `liveWhen`
 *  cell's standing view) can wire through it too, instead of every call site
 *  re-hand-rolling the same edge-effect (which drifts: a hand-rolled version tends
 *  to run the callback TRACKED, re-subscribing the effect to whatever the handler
 *  itself reads, where this helper's `on()` runs it untracked). */
export function wireSubscriptionError(
  sub: { error: Accessor<Error | undefined> },
  onError: (err: Error) => void,
): void {
  createEffect(
    on(
      () => sub.error(),
      (err) => {
        if (err) onError(err);
      },
    ),
  );
}
