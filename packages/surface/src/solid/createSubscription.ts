/**
 * SolidJS primitive for consuming Effect streams as reactive signals.
 *
 * `createSubscription()` — `Stream<T>` → SolidJS Accessor
 *
 * **The Effect↔Solid edge (PLAN D10).** This is a SANCTIONED `Effect.runFork`
 * boundary, and one of very few: SolidJS's reactive graph is push-based and
 * synchronous, so a stream has to be *run* somewhere for its frames to become
 * signal writes. It is run from the EFFECT PHASE of the owner that creates it (see
 * {@link createStreamLifecycle}), so a fiber that already has frames before its
 * first async boundary cannot write them into reactive state from the owned scope
 * that built the view. The fiber is SCOPED — it is interrupted by the
 * subscription's own teardown (that effect's returned cleanup, or an external
 * `signal`), and interruption propagates into the stream's finalizers, which is
 * what closes the wire subscription. There is no abort signal to thread and none
 * to forget: cancellation IS interruption.
 *
 * The stream handed in is expected to already carry the framework's retry fence
 * (`unenrolledStreamCall` / the bound `.use()` hooks apply it), so a transport drop
 * never reaches this loop as an error — it reaches it as a fresh snapshot, which is
 * exactly what the change-iff-fired law below is written against.
 *
 * For mutations, call the server directly (a unary member call returns a Promise).
 * If you need loading/error tracking for a mutation, read its Promise through an
 * async `createMemo` under `<Loading>` / `<Errored>`.
 */

import type { Stream } from "effect";
import {
  type Accessor,
  createEffect,
  createSignal,
  createStore,
  getOwner,
} from "solid-js";
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
 * reactive read, just like any signal from `createSignal`. `error` and
 * `pending` are accessors beside it, read the same way.
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
  /** Subscribe to the FACT of a change — the same change-iff-fired law as
   *  {@link updated}, fired at the same moments, but without the payload.
   *
   *  The distinction is not stylistic and it is not a mode: `updated` must hand
   *  its handlers a COPY, because the store ADOPTS a frame as its own backing, so
   *  a retained `{prev, next}` would alias live store state and a consumer poking
   *  at it would be writing into the store behind the store's back. That copy is
   *  two `structuredClone`s of a whole frame, and it is the price of the payload.
   *  A consumer that only wants to know THAT something arrived — a frame counter,
   *  a re-ask trigger, an invalidation — was paying it
   *  for a value it discarded: two deep clones of a hundred-kilobyte page, per
   *  keystroke, for an integer. Subscribe here instead and the clones do not
   *  happen at all; nothing else about the law moves (a first frame is still not a
   *  change, an equal reconnect snapshot is still silent).
   *
   *  Optional for the same reason as {@link updated} and `complete`: a
   *  hand-assembled `Subscription`-shaped value need not provide it; every
   *  subscription minted by this module's factories does. */
  readonly changed?: (handler: () => void) => Dispose;
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
   * When provided, it OWNS the lifetime instead of the creating owner — which is
   * what allows a subscription outside a reactive owner (e.g. dynamic per-entity
   * maps).
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
  /** The field that identifies an element of an array inside this subscription's
   *  frames — see `./writeValue.ts`, which is the seam that reads it, and
   *  `CellSpec.arrayKey` in `../define.ts`, which is where a MEMBER declares it.
   *
   *  A member's hooks (`useCell`, `useStream`) thread the declaration off the
   *  descriptor, so a `.use()` call site never supplies it. It is spellable here
   *  because this primitive takes a RAW `Stream<T>` with no member behind it: such
   *  a caller has no declaration to inherit and is itself the definition site. */
  arrayKey?: string;
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
 *  Package-private (never on the `./solid` barrel): it is THE frame comparator for
 *  {@link Subscription.updated}, its reactive twin, and `useCollectionDeltas`'s
 *  snapshot arm — the three places this package asks "is this frame the same content
 *  as the last one?". Exported so that question has ONE answer instead of a second
 *  hand-rolled one per store-writing seam.
 *
 *  EVERY own symbol is content, with no exception carved out for the store, and
 *  that is a fact about Solid 2 rather than a relaxation: a store neither stamps
 *  nor mutates a value it is handed. It ADOPTS a frame as its own backing by a
 *  pointer swap (`@solidjs/signals` 2.0.3 `dist/dev.js` `adoptPB` :4392), tracks
 *  the wrapping in a private lookup rather than on the object, and CLONES before
 *  a draft write touches anything — so an object a consumer has read through a
 *  store proxy carries exactly the own symbols it arrived with (probed: a frame
 *  adopted, wrapped, read through, and written over still answers
 *  `Object.getOwnPropertySymbols(frame)` with `[]`). There is no store tag to
 *  exempt, so the "never claim an equality we can't prove" contract is total:
 *  an own symbol here is frame content, and content this comparator cannot read
 *  through `getOwnPropertyNames` makes the two frames unequal.
 *
 *  Why hand-rolled and not `dequal` / `fast-deep-equal` (both already in the
 *  lockfile): a deep-equal here MUST be cycle-safe (a `directDispatch` frame can be
 *  cyclic) AND never false-positive (a false-positive DROPS a real change — the
 *  bug). `dequal` and `fast-deep-equal` recurse without cycle tracking, so a
 *  cyclic frame stack-overflows rather than compares — the exact case this
 *  comparator's path-scoped `Pairing` is built for. The narrow, verifiable "prove
 *  equal or return false" contract is the point; a general library that can't
 *  make that guarantee is the wrong tool, not a missing dependency. */
export function framesEqual(a: unknown, b: unknown): boolean {
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
    // can't prove, so a real change is never suppressed. An own symbol-keyed VALUE
    // likewise forces `false`: `getOwnPropertyNames` cannot see it, and the store
    // never plants one of its own (see {@link framesEqual}), so every own symbol
    // here is frame content nothing else compares.
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

/** Fan a frame out to one channel's subscribers, guarded per handler.
 *
 *  The guard is the point, and it is why both channels come through here rather
 *  than writing the loop twice: one consumer's throwing callback must not abort
 *  fan-out to the others, and — critically for a SHARED subscription behind the
 *  keyed cache — must not escape into the stream-consume `catch`, where it would
 *  be misreported as an upstream stream error and terminate the iterator for
 *  EVERY cached consumer. Report loudly, keep going. `label` names the channel in
 *  that report, so a thrown handler is traceable to the verb it was registered
 *  under. The set is copied before iterating, so a handler that unsubscribes
 *  itself (or a sibling) mid-fan-out cannot perturb the walk. */
function notifyAll<A extends unknown[]>(
  handlers: ReadonlySet<(...args: A) => void>,
  args: A,
  label: string,
): void {
  for (const h of [...handlers]) {
    try {
      h(...args);
    } catch (err) {
      console.error(`subscription \`${label}\` handler threw`, err);
    }
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
 *     snapshot) is silent; a differing frame fans out one change.
 *   - `reset()` — a fresh subscription (the reactive factory's input change)
 *     re-arms the first-frame rule; handlers survive (they belong to the caller).
 *   - `updated(handler)` — subscribe WITH the `{prev, next}` payload.
 *   - `changed(handler)` — subscribe to the FACT alone.
 *
 *  ONE law, two subscriber sets, and the split is exactly the copy: `prev` and
 *  `next` must be CLONED before they are handed out, because the store ADOPTS a
 *  frame as its own backing. Nothing else needs cloning, so a
 *  frame with only `changed` subscribers takes none — the deep compare that
 *  decides whether to fire at all still runs, and must, since it is what keeps an
 *  equal reconnect snapshot silent. */
export function createUpdatedTracker<V>(): {
  noteFrame: (next: V) => void;
  updated: (handler: (change: CellChange<V>) => void) => Dispose;
  changed: (handler: () => void) => Dispose;
  reset: () => void;
} {
  const handlers = new Set<(change: CellChange<V>) => void>();
  const factHandlers = new Set<() => void>();
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
      // Hot-path short-circuit: with no handler of EITHER kind registered, the
      // baseline just advances to the latest frame in O(1) — a handler added later
      // sees only changes FROM that point on, so it never needs the intervening
      // compares. This keeps the deep `framesEqual` off every cell/stream/collection
      // frame for the overwhelmingly common nobody-is-listening case.
      if (handlers.size === 0 && factHandlers.size === 0) {
        lastSeen = { kind: "seen", value: next };
        return;
      }
      if (framesEqual(lastSeen.value, next)) return; // equal reconnect snapshot: silent
      const prev = lastSeen.value;
      lastSeen = { kind: "seen", value: next };
      // Hand payload consumers a COPY: the store ADOPTS these frames — a written
      // frame IS the store's backing, not a copy of it (`writeValue.ts`) — so a
      // retained `{prev, next}` would alias live store state, and a consumer that
      // poked at its payload would be writing into the store behind the store's
      // back (no node notified, no fold run). Clone only when somebody is actually
      // going to READ the payload: a frame watched only by `changed` subscribers
      // pays nothing here, which is the whole reason that channel exists.
      if (handlers.size > 0) {
        notifyAll(
          handlers,
          [
            {
              prev: structuredClone(prev),
              next: structuredClone(next),
            } satisfies CellChange<V>,
          ],
          "updated",
        );
      }
      notifyAll(factHandlers, [], "changed");
    },
    updated(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    changed(handler) {
      factHandlers.add(handler);
      return () => factHandlers.delete(handler);
    },
    reset() {
      lastSeen = { kind: "unseen" };
    },
  };
}

/** The three signals a stream-backed view carries, independent of what it does with
 *  the frames. `error` is terminal (a failure is the fiber's exit), `pending` is true
 *  until the first frame or a terminal outcome, `complete` latches on a TYPED end and
 *  means the value is frozen forever.
 *
 *  Named separately from {@link Subscription} because they are separable: a batched
 *  collection view has ONE stream behind N per-key accessors, so its lifecycle is one
 *  fact while its value is many. That is the whole reason
 *  {@link createStreamLifecycle} exists apart from {@link createSubscription}. */
export interface SubscriptionState {
  readonly error: Accessor<Error | undefined>;
  readonly pending: Accessor<boolean>;
  readonly complete: Accessor<boolean>;
}

/** The refusal every view-opening primitive throws when the call has neither a
 *  reactive owner nor an `AbortSignal` — one wording, worded from the CALLER.
 *
 *  `name` is the primitive the consumer actually called, so the message names
 *  something they can find, not the shared seam underneath it. `acceptsSignal`
 *  says whether that primitive exposes `options.signal`: the batched collection
 *  path does not, so its advice stops at "call it from a component / createRoot"
 *  rather than offering an option its caller has no way to spell. */
export function noLifetimeRefusal(caller: {
  name: string;
  acceptsSignal: boolean;
}): Error {
  return new Error(
    caller.acceptsSignal
      ? `${caller.name}: must run under a reactive owner, or be given ` +
        "`options.signal` — the view's lifetime is one or the other, and with " +
        "neither nothing can ever interrupt its fiber or close the wire " +
        "subscription behind it. Call it from a component / createRoot, or " +
        "pass an AbortSignal."
      : `${caller.name}: must run under a reactive owner — the owner's ` +
        "disposal is the only thing that can interrupt the view's fiber and " +
        "close the wire subscription behind it, so an ownerless view would " +
        "leak both. Call it from a component / createRoot.",
  );
}

/** Drive `source` on its own scoped fiber and report its lifecycle as the three
 *  signals of a {@link SubscriptionState}, handing each frame to `onFrame`.
 *
 *  THE stream-lifecycle seam for a static-input source, and the reason it is one:
 *  what varies between the framework's static-input views is only what they do with
 *  a frame — `createSubscription` reduces it into a wrapped store, the batched
 *  collection view writes the keys the frame names — while the fiber, the three
 *  signals, the teardown path and the `onError` edge are identical. Two hand-rolled
 *  copies of that skeleton drift; they had already drifted the first day they
 *  existed.
 *
 *  THE FIBER IS STARTED FROM THE EFFECT PHASE, never from the scope that calls this
 *  function, and that is load-bearing rather than stylistic. `Effect.runFork` runs a
 *  stream SYNCHRONOUSLY to its first async boundary, so a fiber whose opening frames
 *  are already there (an in-process link, a replayed snapshot) delivers them before
 *  `runStreamScoped` returns. Started inline, a view created in a component body
 *  would therefore write its own three signals — and, for `createSubscription`, the
 *  wrapped STORE — inside that owned scope, which Solid refuses in dev (a store
 *  write there throws; a signal write there is a diagnostic no `ownedWrite` flag on
 *  THIS side should be papering over, since the delivery, not the signal, is what is
 *  misplaced). A `createEffect` whose effect half starts the fiber and RETURNS its
 *  stopper runs unowned, after the creating scope has returned, so no frame is ever
 *  written in an owned scope and the frame handler may write stores freely. The one
 *  behavioural consequence: a synchronously-available first frame lands one flush
 *  after creation rather than during it, which the view already reports honestly —
 *  `pending()` is true until it arrives, exactly as for any async source.
 *
 *  A frame is applied and `pending` cleared in ONE synchronous handler, so the
 *  writes share a flush: no consumer ever observes a frame applied while the view
 *  still reads pending, and a view that writes several signals per frame (a keyed
 *  store plus its key list plus its folds) settles them in one tick.
 *
 *  `createReactiveSubscription` deliberately does NOT build on this: its lifecycle
 *  RE-ARMS on every input change (fresh fiber, signals reset, tracker reset), which
 *  is a different lifetime rather than a different frame handler — folding it in
 *  would put two lifetimes behind one door. (It reaches the same effect-phase start
 *  by its own route: its fiber is opened by the effect half of the effect that
 *  tracks the input.) */
export function createStreamLifecycle<T>(
  source: Stream.Stream<T, unknown>,
  options: {
    /** WHO is refusing, when this view turns out to have no lifetime at all. The
     *  message names this primitive and words its advice from what THIS caller
     *  accepts — the collection path reaches the same refusal and exposes no
     *  `signal`, so telling its caller to pass one would name an option it has
     *  no way to spell. */
    caller: { name: string; acceptsSignal: boolean };
    /** One stream frame. Runs before `pending` clears, in the same flush. */
    onFrame: (item: T) => void;
    /** The stream ENDED NORMALLY (a typed end), never on abort. */
    onComplete?: () => void;
    /** Per-consumer failure callback, wired through the same edge effect
     *  {@link wireSubscriptionError} owns, so it can never disagree with `error()`. */
    onError?: (err: Error) => void;
    /** External abort signal, INSTEAD of the owner's teardown — never both, so there
     *  is no dual lifecycle to braid. The signal arm is what lets a view be created
     *  outside a reactive owner (a dynamic per-entity map); with no owner there is no
     *  effect phase to start from — and equally no owned scope to write from — so
     *  that case alone starts the fiber inline. */
    signal?: AbortSignal;
  },
): SubscriptionState {
  const [error, setError] = createSignal<Error | undefined>(undefined);
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);
  const state: SubscriptionState = { error, pending, complete };

  /** The running fiber's stopper, once {@link start} has run. */
  let stop: (() => void) | undefined;
  /** This view's lifetime is OVER — set by {@link end}, and read by {@link start} so
   *  a lifetime that ended before the deferred start (an abort in the same tick as
   *  the creation) never opens a fiber nobody will close. */
  let ended = false;

  /** Open the fiber. `runStreamScoped` owns the "a disposed subscription reports
   *  nothing" rule, so nothing in the handlers re-checks an aborted flag. */
  const start = (): void => {
    if (ended) return;
    const stopFiber = runStreamScoped<T>(source, {
      onFrame: (item) => {
        options.onFrame(item);
        // Unconditional: writing `false` over `false` is a no-op under the signal's
        // default equality, so a read-then-write guard would only re-state that.
        setPending(false);
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
        setPending(false);
        setComplete(true);
        options.onComplete?.();
      },
      onFailure: (err) => {
        setError(err);
        setPending(false);
      },
    });
    // The view can END from INSIDE the call above: a source whose first step
    // aborts the external signal (an opening that cancels its own view) runs
    // before the stopper exists, so that `end` found nothing to stop. Re-check
    // here and stop it — the latch the stopper sets is what makes the failure
    // racing the stop silent, so without this the dead view reports its exit.
    if (ended) stopFiber();
    else stop = stopFiber;
  };

  /** End this view: interrupt the fiber (which runs the stream's finalizers — the
   *  wire unsubscribe) and refuse any later start. */
  const end = (): void => {
    ended = true;
    stop?.();
    stop = undefined;
  };

  if (options.signal) {
    // The signal OWNS the lifetime, so nothing here binds the fiber to the creating
    // owner: the effect below starts it and returns no cleanup.
    if (options.signal.aborted) ended = true;
    else options.signal.addEventListener("abort", end, { once: true });
    // Under an owner, the start still belongs in THAT owner's effect phase — the
    // frames would otherwise be written in its scope, whoever ends the view. With
    // no owner (the case this arm exists for) the inline start is not a fallback
    // but the only reading: there is no owned scope for a frame to be written
    // from, so nothing to defer around, and no effect phase to defer INTO — an
    // ownerless `createEffect` is itself a defect Solid names (`NO_OWNER_EFFECT`,
    // "Effect created without reactive owner"), because nothing would ever
    // dispose it. The signal carries the whole lifetime either way.
    if (getOwner()) {
      createEffect(
        () => undefined,
        () => {
          start();
        },
      );
    } else {
      start();
    }
  } else {
    // The creating owner IS the lifetime: the effect's returned cleanup interrupts
    // the fiber when that owner disposes — one teardown path, the same one that
    // opened the fiber. A static source has nothing reactive to read, so the
    // compute returns a constant: this effect exists only to put the start in the
    // effect phase.
    //
    // So a view with NEITHER an owner nor a signal has no lifetime at all, and is
    // refused here rather than opened. Solid only warns (`NO_OWNER_EFFECT`): the
    // effect would still run, nothing would ever dispose it, and the fiber — and
    // the wire subscription its finalizers close — would outlive everything with
    // no handle left to stop it. That is the silent leak this package refuses by
    // construction everywhere else it can (`createKeyedRoot`, `fold`,
    // `client.rawStream`).
    if (!getOwner()) throw noLifetimeRefusal(options.caller);
    createEffect(
      () => undefined,
      () => {
        start();
        return end;
      },
    );
  }

  if (options.onError) wireSubscriptionError(state, options.onError);

  return state;
}

/** Convert an Effect `Stream` into a SolidJS signal.
 *
 *  `source` is LAZY and is run on a scoped fiber owned by this subscription (see
 *  `./runStream`), opened in the EFFECT PHASE of the creating owner so no frame is
 *  ever written into the scope that built the view. Disposing the subscription —
 *  that owner unwinding, or the external `options.signal` — INTERRUPTS that fiber,
 *  and interruption runs the stream's own finalizers, which is what cancels the
 *  wire subscription. Without that, teardown would only stop READING the stream
 *  while the server-side subscription (and its bounded frame queue) stayed open
 *  until the stream happened to end on its own — forever, for a quiet cell that
 *  never publishes again.
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
  // The change-iff-fired half of the Dynamic — the ONE law shared with
  // `createReactiveSubscription` via `createUpdatedTracker`.
  const tracker = createUpdatedTracker<T | R>();
  // The reduce accumulator is HELD here, not re-read off the store: a store write
  // lands on the next flush, and a fiber can deliver several frames inside one
  // synchronous turn, so reading `store.v` back would fold the second frame onto
  // the value the first one replaced. The store is the VIEW of the accumulator;
  // this is the accumulator.
  let acc: T | R | undefined = initial;

  // The fiber, the three signals, the teardown path and the `onError` edge are the
  // shared seam; the ONE thing this primitive contributes is what a frame does —
  // reduce it, tell the tracker, write it into the wrapped store.
  const state = createStreamLifecycle<T>(source, {
    caller: { name: "createSubscription", acceptsSignal: true },
    onFrame: (item) => {
      acc = reduce ? reduce(acc as T | R, item) : (item as T | R);
      tracker.noteFrame(acc); // fire `updated` on a genuine change, before the write
      writeWrappedValue(setStore, acc, options?.arrayKey);
    },
    onComplete: options?.onComplete,
    onError: options?.onError,
    signal: options?.signal,
  });

  return Object.assign(() => store.v as (T | R) | undefined, {
    ...state,
    updated: tracker.updated,
    changed: tracker.changed,
  }) as Subscription<T | R>;
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
 *  itself reads, where this helper reads `error()` in the COMPUTE and runs the
 *  callback in the effect phase, which is untracked by construction). */
export function wireSubscriptionError(
  sub: { error: Accessor<Error | undefined> },
  onError: (err: Error) => void,
): void {
  createEffect(
    () => sub.error(),
    (err) => {
      if (err) onError(err);
    },
  );
}
