/**
 * @kolu/surface/server — server-side bindings for the typed reactive surface.
 *
 * Headline API: `implementSurface(surface, deps)` walks a `Surface` (from
 * `defineSurface`) and returns a supervised `SurfaceRuntime`
 * `{ router, ctx, done, close }` — every cell/collection/stream/event/procedure
 * wired in one declarative call. `router` is the FINAL top-level oRPC router:
 * serve it directly (no consumer re-finalizes the surface via oRPC `implement`).
 * The framework owns the snapshot+deltas wire protocol on both sides; client
 * `useCell` / `useCollection` / `useStream` consume what `implementSurface`
 * produces, and `ctx.cells.X.set(...)` etc. let domain code mutate without
 * parallel store-and-publish paths. `done` rejects on an owned runtime fault and
 * `close` releases every owned source (see {@link SurfaceRuntimeHandle}).
 *
 * Persistence and pub/sub are pluggable via `CellStore<T>` and
 * `Channel<T>` interfaces. Adapters for `conf` (`confStore`) and
 * `@orpc/experimental-publisher` (`publisherChannel`) ship with the
 * framework; consumers can supply their own.
 *
 * Low-level escape hatches: `cellHandlers` / `collectionHandlers` /
 * `streamHandlers` / `eventHandlers` build the same handler bodies for
 * a single primitive — useful when a primitive needs custom plumbing
 * that doesn't fit `implementSurface`'s declarative path.
 */

import { implement } from "@orpc/server";
import type { ZodType } from "zod";
import {
  collectionDeltasChannel,
  collectionKeyChannel,
  collectionKeysetChannel,
} from "./channelNames";
import {
  type CellSpec,
  type CollectionDelta,
  type CollectionDeltasMsg,
  type CollectionSpec,
  collectionHasDeltas,
  composeSurfaceContracts,
  type EventSpec,
  type ProcedureSpec,
  resolveCellVerbs,
  resolveCollectionVerbs,
  type StreamSpec,
  type Surface,
  type SurfaceSpec,
} from "./define";

// `composeSurfaceContracts` is a browser-safe, contract-only helper — it
// lives in `./define` so a browser-reached common module can value-import it
// without dragging `@orpc/server` into the client bundle. Re-exported here so
// server-only consumers that already import from `@kolu/surface/server` keep
// working.
export { composeSurfaceContracts };

import { CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB } from "./clockNow";
import {
  type BakedIdentity,
  IDENTITY_NAMESPACE,
  IDENTITY_VERB,
  serveIdentity,
} from "./identity";
import type { Cell, Collection, Event, Stream } from "./index";
import { LIVENESS_NAMESPACE, LIVENESS_VERB } from "./liveness";
// The derived-cell brands live in their own import-free leaf so the boot walk
// can spot a reactor `derived.cell(...)` dep — and its compute-fn variant —
// WITHOUT importing `reactor.ts` (which imports the signals engine). The walk
// bridges each sibling into the graph through plain `SiblingSource` closures
// (read + a synchronous post-equals change edge), so the engine stays reachable
// only through `reactor.ts`: the walk itself never touches a signal.
import {
  isDerivedCellDeps,
  isDerivedComputeCellDeps,
  type SiblingSource,
  type SiblingSourcesRuntime,
} from "./reactorBrand";
// Type-only: the compute-cell carrier is the return of `derived.cell(($) => …)`,
// used purely to type the cell deps slot. `import type` is fully erased under
// this repo's `isolatedModules` + esbuild bundling, so it pulls NO engine value
// into `server.ts`'s runtime graph (the leaf rationale above stands).
import type { DerivedComputeCell } from "./reactor";

/** This server process's start time (ms epoch), captured once when the serve path
 *  module loads — which, for a daemon that imports it at boot, is the process
 *  start. The reserved `system.identity` stamps it (the uptime source), so a server
 *  never has to thread its own start time through `implementSurface`. */
const SERVER_STARTED_AT = Date.now();

// `projectSurface` and its derive helpers are server-side (they import
// `implementSurface` from here), so they live in `./project` and are imported
// from the dedicated `@kolu/surface/project` subpath — the canonical import for
// adapter authors. They are intentionally NOT re-exported here: `./project`
// imports `./server`, so re-exporting it back would form an import cycle.

// ── Persistence + pub/sub interfaces ───────────────────────────────────

/** Persistence interface for a Cell or Collection's storage backend. */
export interface CellStore<T> {
  get(): T;
  set(value: T): void;
}

/** A typed publish/subscribe channel. `publish` triggers all live
 *  iterators to emit the value; `subscribe` returns an AsyncIterable that
 *  yields each future publish until `signal` aborts; `consume` spawns a
 *  fire-and-forget loop that dispatches each value to `onEvent` and
 *  surfaces unexpected errors via `onError`, returning a cleanup fn. */
export interface Channel<T> {
  publish(value: T): void;
  subscribe(signal: AbortSignal | undefined): AsyncIterable<T>;
  /** Subscribe and dispatch each value to `handlers.onEvent` until
   *  cleanup. Owns the AbortController and suppresses post-abort errors
   *  (the publisher's iterator rejects with `signal.reason` on shutdown,
   *  which is expected end-of-life noise rather than a real failure).
   *
   *  `onError` is required to keep silent-swallow at the call site an
   *  explicit choice — pass `() => {}` for fire-and-forget where the
   *  consumer genuinely doesn't care. */
  consume(handlers: {
    onEvent: (value: T) => void;
    onError: (err: unknown) => void;
  }): () => void;
}

// ── Cell handlers ──────────────────────────────────────────────────────

export interface CellHandlerDeps<T, P = T> {
  /** Persistence backend. The framework reads on `get` first-yield and
   *  writes on every mutation. Pass `inMemoryStore(default)` for ephemeral
   *  cells (terminal-list etc.). */
  store: CellStore<T>;
  /** Publish channel used to broadcast mutation echoes to subscribers. */
  bus: Channel<T>;
  /** Pure merge for partial-update mutations. Required when the cell's
   *  `set`-equivalent procedure takes a patch shape `P` distinct from `T`
   *  (e.g. `PreferencesPatch`). When omitted, `set/patch` treat input as
   *  full-value `T`. */
  patch?: (current: T, p: P) => T;
  /** Optional equality predicate. When supplied, `set` / `patch` /
   *  `test__set` skip the store write and bus publish when the next
   *  value equals the current one. See `CellSpec.equals` in `define.ts`
   *  for the rationale. */
  equals?: (a: T, b: T) => boolean;
  /** Optional pre-mutation hook. Receives the *raw* patch / input value
   *  `P` (i.e. before `deps.patch` is applied) and the *current* stored
   *  value `T`. Fires on `set` and `patch` from the wire, *before* the
   *  `equals` dedup gate — i.e. fires even for no-op writes. Does **not**
   *  fire for `test__set` or for the server-internal
   *  `ctx.cells.<key>.set/patch`. Use for client-action audit logging
   *  and invariant checks that depend on the unresolved patch shape.
   *
   *  Compare `onWrite`: post-merge `T` payload, fires after the `equals`
   *  gate (no-ops skipped), fires on every write path including
   *  `test__set` and `ctx.cells.<key>.set`. */
  onMutate?: (patch: P, current: T) => void;
  /** Optional fire-and-forget side effect that runs synchronously on
   *  every successful write — `set`, `patch`, `test__set`, and the
   *  server-internal `ctx.cells.<key>.set`. Receives the resolved
   *  post-merge value `T`. Runs *after* the `equals` gate (no-op writes
   *  don't fire `onWrite`), just before `store.set` / `bus.publish`.
   *  Use for cross-cell invariants the cell write must atomically
   *  establish (e.g. cancelling a competing autosave timer when an
   *  external write lands on the session cell). Contrast with
   *  `onMutate`'s pre-merge `P` payload and wire-only fan-out. */
  onWrite?: (next: T) => void;
  /** Write-FORWARDING seam. When supplied, the wire `set` / `patch` /
   *  `test__set` handlers call THESE instead of the local apply-and-publish
   *  path (`equals` → `onWrite` → `store.set` → `bus.publish`). The cell then
   *  becomes a pure READ mirror: `get` still folds from `store` (which only a
   *  server-internal writer — the mirror fold via `ctx.cells.<key>.set` — ever
   *  writes), while a WIRE write crosses to an authoritative upstream and comes
   *  back through the fold. Both the local `equals` dedup and the local
   *  `bus.publish` are BYPASSED on purpose: the upstream is the authority, so a
   *  wire write whose value equals the stale local mirror must STILL forward
   *  (never dedup-dropped), and the local mirror must NOT phantom-echo the write
   *  before the upstream confirms it (a rejected upstream write would otherwise
   *  strand a value the mirror never reverts). The `@kolu/surface-remote`
   *  re-serve is the consumer. */
  forward?: CellForward<T, P>;
  /** Mirror-never-fabricate gate (forward mirrors only). When present, `get`
   *  withholds the opening snapshot until this returns `true` — i.e. until the
   *  authority's first real frame has folded into `store`. Before that, the
   *  seeded default is a fabrication asserted by NOBODY (the mirror needed
   *  something to show), byte-indistinguishable from a value the authority
   *  actually sent — the exact frame that makes a reconnect fire duplicate
   *  notifications. Withholding it makes the reader's `T | undefined` ("no frame
   *  yet") true end-to-end: the mirror relays truth or stays silent; the declared
   *  default belongs to the ONE writer. Omitted (the authoring, non-mirror case)
   *  means "always serve the snapshot" — that endpoint IS the authority, so its
   *  default is legitimate. */
  hasSnapshot?: () => boolean;
}

/** The write-forwarding handlers a re-serving mirror plugs into
 *  {@link CellHandlerDeps.forward} — one per wire mutation verb. Each returns
 *  the forward's promise so oRPC awaits the upstream write and propagates its
 *  rejection to the wire client (fail-fast: a forward with no live upstream link
 *  throws loud, never a silent local no-op). */
export interface CellForward<T, P = T> {
  set: (input: T) => void | Promise<void>;
  patch: (input: P) => void | Promise<void>;
  test__set: (input: T) => void | Promise<void>;
}

export interface CellHandlers<T, P = T> {
  /** Snapshot+deltas get handler. Plug into `t.X.get.handler(handlers.get)`. */
  get: (opts: { signal?: AbortSignal }) => AsyncGenerator<T>;
  /** Full-value set handler. Plug into `t.X.set.handler(handlers.set)`.
   *  Typed `void`, but when `deps.forward` is set the body still RETURNS the
   *  forward's promise at runtime (the void-return position permits it), so oRPC
   *  awaits the upstream write and propagates its rejection to the wire client. */
  set: (opts: { input: T }) => void;
  /** Patch handler — applies `deps.patch(current, input)` and persists (or, when
   *  `deps.forward` is set, forwards the raw patch upstream). */
  patch: (opts: { input: P }) => void;
  /** Test reset handler. Same as `set` but used by e2e fixtures. */
  test__set: (opts: { input: T }) => void;
}

/** Build the server-side handler suite for a Cell. Returns raw handler
 *  functions ready for `t.X.get.handler(handlers.get)` etc.
 *
 *  Snapshot+deltas invariant on `get`: yields `store.get()` first, then
 *  every value pushed to `bus`. The streaming retry plugin re-invokes
 *  `get` on every reconnect, so the first frame must be a fresh snapshot
 *  — the framework guarantees this here. */
export function cellHandlers<Name extends string, T, P = T>(
  _cell: Cell<Name, T>,
  deps: CellHandlerDeps<T, P>,
): CellHandlers<T, P> {
  function applyAndPublish(next: T): void {
    // Dedup gate: skip the store write and bus publish when the next
    // value compares equal to the current one. Opt-in per cell via
    // `CellSpec.equals` / `CellHandlerDeps.equals`. Default is "always
    // publish" — see `CellSpec.equals` for the rationale.
    if (deps.equals?.(deps.store.get(), next)) return;
    deps.onWrite?.(next);
    deps.store.set(next);
    deps.bus.publish(next);
  }

  // Write-forwarding mirror: each wire mutation crosses to the authoritative
  // upstream and returns through the fold, so the local apply-and-publish path
  // (equals → onWrite → store.set → bus.publish) AND `onMutate` are skipped
  // entirely — the mirror never mutates or phantom-publishes on a wire write.
  const forward = deps.forward;
  if (forward) {
    return {
      get: async function* ({ signal }) {
        // Subscribe BEFORE the snapshot decision, and make the two one
        // synchronous step (no await between): the authority's first fold is
        // then either already past (`hasSnapshot()` true → replay the folded
        // value as the snapshot for a late subscriber) or still future (captured
        // by `sub`, delivered as the first frame) — never missed, never
        // double-served. Mirror-never-fabricate: withhold the seeded default
        // until the fold has primed the store (`hasSnapshot()` false).
        const sub = deps.bus.subscribe(signal);
        if (deps.hasSnapshot?.() ?? true) yield deps.store.get();
        for await (const v of sub) yield v;
      },
      set: ({ input }) => forward.set(input),
      patch: ({ input }) => forward.patch(input),
      test__set: ({ input }) => forward.test__set(input),
    };
  }

  return {
    get: async function* ({ signal }) {
      yield deps.store.get();
      for await (const v of deps.bus.subscribe(signal)) yield v;
    },
    set: ({ input }) => {
      deps.onMutate?.(input as unknown as P, deps.store.get());
      applyAndPublish(input);
    },
    patch: ({ input }) => {
      const current = deps.store.get();
      deps.onMutate?.(input, current);
      const next = deps.patch
        ? deps.patch(current, input)
        : (input as unknown as T);
      applyAndPublish(next);
    },
    test__set: ({ input }) => {
      applyAndPublish(input);
    },
  };
}

// ── Collection handlers ────────────────────────────────────────────────

export interface CollectionHandlerDeps<K, T> {
  /** Read all current entries. Snapshot is yielded as the first frame of
   *  `keys` and `get(key)`. */
  readAll: () => Map<K, T>;
  /** Read one entry — used by per-key `get` snapshot. Defaults to
   *  `readAll().get(key)`. Override when a per-key fast path exists. */
  readOne?: (key: K) => T | undefined;
  /** Persist an upsert and broadcast to subscribers of that key. */
  upsert: (key: K, value: T) => void;
  /** Persist a delete and broadcast removal to subscribers. */
  remove: (key: K) => void;
  /** Bus for per-key value updates. Subscribers watch `(channel, key)`. */
  perKeyBus: (key: K) => Channel<T>;
  /** Bus for the live key set (broadcasts `K[]` snapshots on add/remove). */
  keysBus: Channel<K[]>;
  /** Bus for the coalesced batched delta stream — one `{upserts, removes}` per
   *  producer tick. Present only when the collection exposes the `deltas` verb
   *  (opt-in); `walkSurface` wires it and the per-tick coalescing together. */
  deltasBus?: Channel<CollectionDelta<K, T>>;
}

/** Per-tick coalescer for a collection's batched `deltas` stream. A `pending`
 *  Map keeps last-op-wins in program order (an upsert then a remove of the same
 *  key in one tick resolves to a remove), and a single `queueMicrotask` flush
 *  runs after the synchronous upsert/remove loop the producer drives — so N
 *  keyed mutations publish ONE `{upserts, removes}` frame instead of N per-key
 *  frames. A bounded, time-based leaf (value + microtask window), lifted out of
 *  `walkSurface` so the spec walk holds no batching state. Constructed only when
 *  the collection opts into `deltas`; the `bus` is non-optional, so "deltas is
 *  on" has a single representation — this coalescer's existence. */
function createTickCoalescer<K, V>(
  bus: Channel<CollectionDelta<K, V>>,
): { upsert: (k: K, v: V) => void; remove: (k: K) => void } {
  const pending = new Map<K, { value: V } | "remove">();
  let flushScheduled = false;
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (pending.size === 0) return;
      const upserts: [K, V][] = [];
      const removes: K[] = [];
      for (const [k, op] of pending) {
        if (op === "remove") removes.push(k);
        else upserts.push([k, op.value]);
      }
      pending.clear();
      bus.publish({ kind: "delta", upserts, removes });
    });
  };
  return {
    upsert: (k, v) => {
      pending.set(k, { value: v });
      scheduleFlush();
    },
    remove: (k) => {
      pending.set(k, "remove");
      scheduleFlush();
    },
  };
}

export interface CollectionHandlers<K, T> {
  keys: (opts: { signal?: AbortSignal }) => AsyncGenerator<K[]>;
  get: (opts: { input: { key: K }; signal?: AbortSignal }) => AsyncGenerator<T>;
  deltas?: (opts: {
    signal?: AbortSignal;
  }) => AsyncGenerator<CollectionDeltasMsg<K, T>>;
  upsert: (opts: { input: { key: K; value: T } }) => void;
  delete: (opts: { input: { key: K } }) => void;
  test__set: (opts: { input: Array<{ key: K; value: T }> }) => void;
}

/** Snapshot-then-live with NO lost-update window: subscribe to `bus` FIRST, THEN
 *  produce the snapshot, then forward. `bus.subscribe()` registers the subscriber
 *  synchronously (see `inMemoryChannel`), so opening the iterator BEFORE producing
 *  the snapshot means any frame published in the snapshot→first-forward window is
 *  BUFFERED, not dropped — the gap a snapshot-then-subscribe generator leaves open
 *  (it doesn't reach `subscribe()` until the consumer's SECOND pull, so a frame born
 *  in that window publishes to ZERO subscribers).
 *
 *  `snapshot` is a THUNK, not a value: it MUST run AFTER `subscribe()`. A caller
 *  passing an already-computed value would move the read back BEFORE the subscribe
 *  and reopen the window — the thunk keeps the `readAll()` on the safe side.
 *
 *  The thunk yields ZERO-OR-MORE frames: it returns an array so a caller with an
 *  unconditional snapshot passes a single-element array, and one whose snapshot is
 *  CONDITIONAL (a `get` on an absent key) passes an empty array — the absent case
 *  collapses to `[]` instead of a bespoke `if`-guarded copy of this machine.
 *
 *  Cleanup: acquire ONE iterator up front and forward it via
 *  `yield* { [Symbol.asyncIterator]: () => iterator }` — NOT a bare `yield* frames`,
 *  which would call `[Symbol.asyncIterator]()` a second time and forward a different
 *  iterator than the one the `finally` returns. The snapshot `yield*` sits BEFORE the
 *  forwarding, so an early `.return()` taken after the snapshot (which makes an async
 *  generator skip everything past the suspended `yield`) still hits the `finally`,
 *  which returns the iterator and drops the subscriber. Idempotent: the channel's
 *  `return()`/`close()` are double-call-guarded. */
async function* subscribeBeforeSnapshot<S, F>(
  bus: Channel<F>,
  signal: AbortSignal | undefined,
  snapshot: () => S[],
): AsyncGenerator<S | F> {
  const frames = bus.subscribe(signal);
  const iterator = frames[Symbol.asyncIterator]();
  try {
    yield* snapshot();
    yield* { [Symbol.asyncIterator]: () => iterator };
  } finally {
    await iterator.return?.();
  }
}

export function collectionHandlers<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  deps: CollectionHandlerDeps<K, T>,
): CollectionHandlers<K, T> {
  const readOne = deps.readOne ?? ((k: K) => deps.readAll().get(k));

  const handlers: CollectionHandlers<K, T> = {
    // `keys` is self-healing (every frame is a full set snapshot, so a consumer
    // folds re-sends idempotently), yet a key born in the snapshot→subscribe window
    // of a QUIESCENT stream has no later frame to self-heal from until the next
    // membership change — so it still needs subscribe-before-snapshot. That, with
    // the `broadcastKeys` publish-side fix, is what lets an already-subscribed mirror
    // never miss a key born after it connected. See `subscribeBeforeSnapshot`.
    keys: ({ signal }) =>
      subscribeBeforeSnapshot(deps.keysBus, signal, () => [
        Array.from(deps.readAll().keys()),
      ]),
    // A `get` for a key that DOESN'T EXIST YET is a legitimate HELD-OPEN
    // subscription, NOT an error. A collection's membership is dynamic by design
    // (the mirror's `initialKeys` reconcile already treats it so, W2.1), so a
    // consumer watching a fixed key may subscribe BEFORE the key is born: the
    // stream stays open, yields NOTHING until the key's first upsert, then
    // delivers it and every later update. Subscribe-before-snapshot (like `keys`)
    // so a value upserted in the snapshot→forward gap isn't lost; the ONLY
    // difference from `keys` is the snapshot is CONDITIONAL — a present key yields
    // its current value, an absent key yields nothing.
    //
    // Ordering note: subscribing BEFORE the snapshot can DOUBLE-DELIVER a value
    // whose upsert lands in the subscribe→snapshot window (the snapshot reads it
    // AND the buffered per-key frame forwards it) — benign and INTENTIONAL: every
    // consumer folds by replacement/reconcile, so a repeated value is idempotent.
    // Do NOT "fix" it by reading the snapshot BEFORE subscribing — that reopens the
    // lost-update gap this ordering exists to close (a frame born in the gap would
    // publish to zero subscribers and be lost). The lost-update prevention is pinned
    // by the "delivers a value published in the post-snapshot gap" test.
    //
    // This held-open-on-absent-key is a DELIBERATE, tested semantic, never an
    // accidental hang. The alternative — throwing "key not found" on the first
    // snapshot — surfaced to a consuming browser as a NON-RETRIABLE `ORPCError`
    // (`STREAM_RETRY` never retries an `ORPCError`) that KILLED its standing
    // subscription: a key born AFTER the subscription opened (kolu-server booting
    // with an empty re-serve mirror; the gray Kaval chip, #1681) then never
    // reached the client until a full page reload. Holding open turns "absent"
    // into a RECOVERABLE waiting state the consumer renders honestly (`undefined`
    // until the first value). A key that NEVER appears leaves the stream open
    // yielding nothing — exactly as a `keys` subscription to an empty collection
    // holds open — so the consumer shows its honest empty/absent state, not a
    // corpse. Callers that need a bounded first read pass a `signal`.
    get: ({ input, signal }) =>
      subscribeBeforeSnapshot(deps.perKeyBus(input.key), signal, () => {
        const v = readOne(input.key);
        return v === undefined ? [] : [v];
      }),
    upsert: ({ input }) => {
      deps.upsert(input.key, input.value);
    },
    delete: ({ input }) => {
      deps.remove(input.key);
    },
    test__set: ({ input }) => {
      // Replace-all: clear current keys, upsert each from the fixture.
      const before = Array.from(deps.readAll().keys());
      for (const k of before) deps.remove(k);
      for (const { key, value } of input) deps.upsert(key, value);
    },
  };

  // The batched `deltas` stream, wired only when the collection opts in (the
  // `deltasBus` is present). Snapshot-then-deltas: a (re)subscribe replays the full
  // set, then each producer tick's coalesced `{upserts, removes}` follows. A
  // `deltas` frame is INCREMENTAL (not a full snapshot), so — UNLIKE the self-healing
  // `keys`/`get` streams — a frame missed in the snapshot→subscribe window is lost
  // until reconnect, which makes subscribe-before-snapshot load-bearing here. See
  // `subscribeBeforeSnapshot`. (A tick whose store write already landed is in BOTH
  // the snapshot and a buffered delta — idempotent: upsert is last-write-wins,
  // remove of an absent key is a no-op.)
  const deltasBus = deps.deltasBus;
  if (deltasBus) {
    handlers.deltas = ({ signal }) =>
      subscribeBeforeSnapshot<CollectionDeltasMsg<K, T>, CollectionDelta<K, T>>(
        deltasBus,
        signal,
        () => [
          {
            kind: "snapshot",
            entries: Array.from(deps.readAll().entries()),
          },
        ],
      );
  }

  return handlers;
}

// ── Stream handlers ────────────────────────────────────────────────────

export interface StreamHandlerDeps<I, T> {
  /** Source factory. Must yield snapshot-then-deltas semantics: first
   *  yield is a fresh full snapshot for the input, subsequent yields
   *  deliver updates. The framework's `pollOnEvent` produces this shape
   *  for poll-on-event sources. */
  source: (input: I, signal: AbortSignal | undefined) => AsyncIterable<T>;
}

export interface StreamHandlers<I, T> {
  get: (opts: { input: I; signal?: AbortSignal }) => AsyncGenerator<T>;
}

export function streamHandlers<Name extends string, I, T>(
  _stream: Stream<Name, I, T>,
  deps: StreamHandlerDeps<I, T>,
): StreamHandlers<I, T> {
  return {
    get: async function* ({ input, signal }) {
      for await (const v of deps.source(input, signal)) yield v;
    },
  };
}

// ── Event handlers ─────────────────────────────────────────────────────

export interface EventHandlerDeps<I, T> {
  /** Occurrence source. Yields zero or more occurrences; **no snapshot
   *  obligation** — the framework explicitly does not require the first
   *  yield to be a current-state snapshot, distinguishing Event from
   *  Stream. A late subscriber misses past occurrences; that's the
   *  contract. */
  source: (input: I, signal: AbortSignal | undefined) => AsyncIterable<T>;
}

export interface EventHandlers<I, T> {
  get: (opts: { input: I; signal?: AbortSignal }) => AsyncGenerator<T>;
}

/** Wire the server side of an `Event<I,T>`. Wire shape matches `streamHandlers`
 *  (oRPC iterator yielding `T`); the contract difference is that the source
 *  may yield zero items and need not start with a snapshot. The split from
 *  `streamHandlers` exists so authors can't accidentally wire an event
 *  source — which has no snapshot — to a stream handler that promises
 *  snapshot-then-deltas.
 *
 *  Implementation note: we forward `deps.source(input, signal)` directly
 *  as the handler's iterator rather than wrapping it in another
 *  `for await of source: yield v` generator. The extra wrap layer would
 *  put oRPC's wire one async tick behind a single-yield-then-return
 *  source — the wire's "iterator complete" frame races the yielded
 *  value's delivery, the consumer's first iteration sees `done: true`,
 *  and the yielded value is dropped. Pinned by `kill.feature` "Natural
 *  PTY exit removes terminal". */
export function eventHandlers<Name extends string, I, T>(
  _event: Event<Name, I, T>,
  deps: EventHandlerDeps<I, T>,
): EventHandlers<I, T> {
  return {
    get: ({ input, signal }) => deps.source(input, signal) as AsyncGenerator<T>,
  };
}

// ── pollOnEvent (poll-on-event-tick stream source) ─────────────────────

/** Repeatedly read on event tick, yield only when the value changed.
 *
 *  Snapshot-then-deltas in the form: yield an initial read, then on every
 *  event from `install` re-read and yield only when `isEqual(last, next)`
 *  is false. The initial read's exception propagates (first frame); a
 *  subsequent read failure invokes `onReadError` and continues — a
 *  transient error shouldn't tear down a long-lived subscription.
 *
 *  `onReadError` is required so the silent-skip path is an explicit choice
 *  at every call site (a misbehaving source that perpetually fails reads
 *  would otherwise burn CPU re-installing and re-reading with zero
 *  observability). Pass `() => {}` if a use case genuinely doesn't care.
 *
 *  The equality predicate stays at the call site so reviewers see it
 *  next to the schema. */
export async function* pollOnEvent<T>(opts: {
  read: () => Promise<T>;
  isEqual: (a: T, b: T) => boolean;
  install: (onEvent: () => void) => () => void;
  signal: AbortSignal | undefined;
  onReadError: (err: unknown) => void;
}): AsyncIterable<T> {
  let last: T = await opts.read();
  yield last;
  for await (const _ of repoEventStream(opts.install, opts.signal)) {
    let next: T;
    try {
      next = await opts.read();
    } catch (e) {
      opts.onReadError(e);
      continue;
    }
    if (opts.isEqual(last, next)) continue;
    last = next;
    yield last;
  }
}

/** Convert a callback-based "something changed" subscription into an
 *  AsyncIterable<void> that yields once per debounced tick.
 *
 *  Coalescing semantics: events that fire while the consumer is mid-yield
 *  collapse into one wakeup (the `dirty` flag flips to true; the consumer
 *  picks it up on the next loop iteration). This complements any upstream
 *  primitive's own debounce — bursts that arrive during snapshot
 *  computation don't queue up extra yields. */
async function* repoEventStream(
  install: (onEvent: () => void) => () => void,
  signal: AbortSignal | undefined,
): AsyncIterable<void> {
  let dirty = false;
  let resolve: (() => void) | null = null;
  // Drain the pending wake promise so the loop's `await` returns. Both
  // the upstream event callback and the abort signal need this exact
  // sequence; factoring it out keeps a future log/error addition from
  // landing in only one path.
  const drainResolve = (): void => {
    if (resolve) {
      const r = resolve;
      resolve = null;
      r();
    }
  };
  const unsub = install(() => {
    dirty = true;
    drainResolve();
  });
  signal?.addEventListener("abort", drainResolve);
  try {
    while (signal?.aborted !== true) {
      if (dirty) {
        dirty = false;
        yield;
        continue;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  } finally {
    signal?.removeEventListener("abort", drainResolve);
    unsub();
  }
}

// ── Built-in CellStore adapters ────────────────────────────────────────

/** In-memory CellStore — for cells with no persistence (e.g. live terminal
 *  list). Initialized with `default` and held in a closure. */
export function inMemoryStore<T>(initial: T): CellStore<T> {
  let value: T = initial;
  return {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
}

/** Single-process broadcast pub/sub `Channel<T>` for surfaces served from a
 *  Node-only process where the `@orpc/experimental-publisher` dependency is
 *  overkill. Each `publish` delivers to every live subscriber synchronously
 *  via per-subscriber queues; `subscribe` returns an `AsyncIterable<T>` that
 *  yields each future publish until `signal` aborts.
 *
 *  Use this when:
 *    - the surface is served from one process (no horizontal scale),
 *    - there's no need for a wire-level publisher,
 *    - you want the same `Channel<T>` shape `implementSurface` already
 *      expects — i.e. a drop-in substitute for `publisherChannel`.
 *
 *  Subscriber backpressure: each subscriber gets its own receive queue. By
 *  DEFAULT the queue is UNBOUNDED — a subscriber that falls behind the
 *  publisher grows its queue in memory (the channel never drops), so consumers
 *  must keep up or unsubscribe. Pass {@link InMemoryChannelOptions.highWaterMark}
 *  to CAP that queue with an explicit, loud breach policy
 *  ({@link InMemoryChannelOptions.overflow}) — `"abort"` (fail-fast: close the
 *  slow subscriber with a {@link ChannelOverflowError} so it re-subscribes) or
 *  `"drop-oldest"` (evict the oldest frame + signal, for a self-healing value
 *  channel). The bound is opt-in precisely so this default stays a drop-in for
 *  every existing consumer; a slow-consumer + unpaced-producer pairing that
 *  can grow without limit should set it.
 *
 *  Ordering: a single `publish` synchronously fans out to all subscribers'
 *  queues before returning, so per-subscriber ordering is preserved. Unlike
 *  `publisherChannel`, there is no cross-channel microtask delay — that
 *  delay is a wire-publisher concern (multiple channels racing on the same
 *  tick). In-process, the same JS scheduler handles ordering. */
export interface InMemoryChannel<T> extends Channel<T> {
  /** Number of currently-attached subscribers. Used by
   *  `inMemoryPublisher` to evict empty per-name channels on
   *  unsubscribe — a process monitor keyed-by-PID accumulates
   *  thousands of dead names otherwise. */
  subscriberCount(): number;
  /** Fires when the subscriber count transitions from >0 to 0. The
   *  publisher uses this to drop the name from its map; null on a
   *  fresh channel so the publisher can detect "channel had a sub at
   *  some point then went idle" vs "never had one". */
  onIdle(cb: () => void): void;
}

/** Per-subscriber receive-queue bound for {@link inMemoryChannel}. Opt-in: omit
 *  the whole options object (or `highWaterMark`) for the historical unbounded
 *  queue. Setting `highWaterMark` REQUIRES an `overflow` policy — an unbounded
 *  grow must never be silent, and a breach must never degrade quietly. */
export interface InMemoryChannelOptions {
  /** Max values buffered for a subscriber that has fallen behind the publisher.
   *  Omit for the unbounded default. */
  highWaterMark?: number;
  /** Breach policy when a subscriber's queue would exceed `highWaterMark`.
   *  Required whenever `highWaterMark` is set (construction throws otherwise):
   *    - `"abort"` — close the subscriber with a {@link ChannelOverflowError}
   *      (its `next()` rejects, the consumer's loop ends loudly). Fail-fast; the
   *      right fit for a byte / fail-through stream that must re-subscribe
   *      end-to-end rather than splice a gap.
   *    - `"drop-oldest"` — evict the oldest queued value to admit the new one
   *      and fire `onOverflow` once per drop, so a self-healing VALUE channel
   *      keeps its newest frames and its consumer re-syncs from the next
   *      snapshot (kaval's attach-overflow precedent). */
  overflow?: "abort" | "drop-oldest";
  /** Fired once per dropped value under `"drop-oldest"` — the loud signal a
   *  value channel's consumer re-syncs on. Ignored for `"abort"`. */
  onOverflow?: () => void;
}

/** Raised on a subscriber's `next()` when its receive queue overflows its
 *  {@link InMemoryChannelOptions.highWaterMark} under the `"abort"` policy — the
 *  loud, fail-fast end that makes the consumer re-subscribe rather than let the
 *  channel grow without limit. */
export class ChannelOverflowError extends Error {
  constructor(queued: number) {
    super(
      `inMemoryChannel: subscriber receive queue exceeded its high-water mark (${queued} buffered) — aborting the stream so the consumer re-subscribes instead of growing unbounded`,
    );
    this.name = "ChannelOverflowError";
  }
}

export function inMemoryChannel<T>(
  opts: InMemoryChannelOptions = {},
): InMemoryChannel<T> {
  const { highWaterMark, overflow, onOverflow } = opts;
  // The bound must carry an explicit breach policy — a silent unbounded grow is
  // exactly the defect this option exists to retire, so a mark without a policy
  // is a wiring bug, not a "default to unbounded" convenience.
  if (highWaterMark !== undefined && overflow === undefined) {
    throw new Error(
      'inMemoryChannel: highWaterMark set without an overflow policy — pass overflow: "abort" | "drop-oldest"',
    );
  }
  const subscribers = new Set<{
    push: (value: T) => void;
    close: (reason?: unknown) => void;
  }>();
  let idleCb: (() => void) | null = null;
  const removeSub = (sub: {
    push: (value: T) => void;
    close: (reason?: unknown) => void;
  }): void => {
    if (subscribers.delete(sub) && subscribers.size === 0) idleCb?.();
  };
  const subscribe = (signal: AbortSignal | undefined): AsyncIterable<T> => {
    const queue: T[] = [];
    const waiters: Array<{
      resolve: (r: IteratorResult<T>) => void;
      reject: (e: unknown) => void;
    }> = [];
    let closed = false;
    let closeReason: unknown;
    const sub = {
      push: (value: T) => {
        if (closed) return;
        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve({ value, done: false });
          return;
        }
        // No waiter parked — this subscriber is behind. Enforce the bound BEFORE
        // buffering, so the queue never grows past the mark.
        if (highWaterMark !== undefined && queue.length >= highWaterMark) {
          if (overflow === "drop-oldest") {
            queue.shift(); // evict the oldest to bound memory; keep the newest
            onOverflow?.();
            queue.push(value);
          } else {
            // "abort": close loudly so the consumer re-subscribes end-to-end, AND
            // drop the sub from the registry. A rejected pending `next()` never
            // triggers `iterator.return()` (the consumer just abandons the
            // iterator), so nothing else reaps this entry — without the remove it
            // would linger forever, taking every later publish's now-no-op
            // `sub.push()`. Mirrors the onAbort + return() paths, which removeSub too.
            sub.close(new ChannelOverflowError(queue.length));
            removeSub(sub);
          }
          return;
        }
        queue.push(value);
      },
      close: (reason?: unknown) => {
        if (closed) return;
        closed = true;
        closeReason = reason;
        while (waiters.length > 0) {
          const waiter = waiters.shift();
          if (!waiter) break;
          if (reason !== undefined) waiter.reject(reason);
          else waiter.resolve({ value: undefined, done: true });
        }
      },
    };
    subscribers.add(sub);
    // Abort handler must ALSO drop the sub from the set — otherwise
    // an aborted subscriber that never has `iterator.return()` called
    // on it (e.g. consumer just rejected its pending next() and
    // abandoned the iterator) stays in `subscribers` forever, getting
    // every subsequent publish's `sub.push()` (which is now a no-op
    // because `closed === true`, but the dead entry sits in memory).
    const onAbort = () => {
      sub.close(signal?.reason);
      signal?.removeEventListener("abort", onAbort);
      removeSub(sub);
    };
    signal?.addEventListener("abort", onAbort);
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<T>> {
            if (queue.length > 0) {
              const value = queue.shift() as T;
              return Promise.resolve({ value, done: false });
            }
            if (closed) {
              if (closeReason !== undefined) return Promise.reject(closeReason);
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve, reject) =>
              waiters.push({ resolve, reject }),
            );
          },
          return(): Promise<IteratorResult<T>> {
            signal?.removeEventListener("abort", onAbort);
            sub.close();
            removeSub(sub);
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  };
  return {
    publish: (value) => {
      for (const sub of subscribers) sub.push(value);
    },
    subscribe,
    consume: buildConsume(subscribe),
    subscriberCount: () => subscribers.size,
    onIdle: (cb) => {
      idleCb = cb;
    },
  };
}

/** Name-keyed in-process pub/sub. Same shape `publisherChannel` already
 *  expects from `@orpc/experimental-publisher`'s `MemoryPublisher`, so
 *  the canonical wiring works uniformly:
 *
 *  ```ts
 *  const publisher = inMemoryPublisher();
 *  implementSurfaceOnPublisher(surface, deps, (name) =>
 *    publisherChannel(publisher, name),
 *  );
 *  ```
 *
 *  Why this exists: the `channel` factory `implementSurfaceOnPublisher`
 *  takes is called *once per publish/subscribe site* — the surface owns
 *  names like
 *  `"<key>:changed"` and `"<key>:key:<k>"`. The consumer must return the
 *  *same* `Channel<T>` instance for the same name, or the framework's
 *  publishes go to one channel and the subscribers register on
 *  another. A bare `inMemoryChannel<T>()` factory (`channel: (name) =>
 *  inMemoryChannel()`) silently drops every delta because each call
 *  creates a fresh channel — the registry layer is doing the
 *  load-bearing work of binding name → instance. */
export function inMemoryPublisher(channelOpts: InMemoryChannelOptions = {}): {
  publish<T>(channel: string, payload: T): void;
  subscribe<T>(
    channel: string,
    opts: { signal?: AbortSignal },
  ): AsyncIterable<T>;
} {
  const channels = new Map<string, InMemoryChannel<unknown>>();
  // Lazy + drop semantics for publish-side names: if no subscriber has
  // ever attached to `name`, drop the payload on the floor rather than
  // create an empty channel that lives forever. The process-monitor
  // demo publishes to `processes:<pid>:value` on every poll for every
  // PID — even when no one is subscribed — and the framework keeps
  // ~600 PIDs hot. Without this guard, every PID ever seen accumulates
  // a permanent (and unused) `InMemoryChannel` instance.
  return {
    publish: <T>(name: string, payload: T) => {
      const c = channels.get(name);
      if (c !== undefined) c.publish(payload as unknown);
    },
    subscribe: <T>(name: string, opts: { signal?: AbortSignal }) => {
      let c = channels.get(name);
      if (c === undefined) {
        c = inMemoryChannel<unknown>(channelOpts);
        channels.set(name, c);
        // Self-evict on idle: when the last subscriber detaches, drop
        // the name from the map so a future publish to that name is a
        // no-op again. Without this, every short-lived subscription
        // leaves a permanent channel behind.
        c.onIdle(() => {
          if (channels.get(name) === c) channels.delete(name);
        });
      }
      return c.subscribe(opts?.signal) as AsyncIterable<T>;
    },
  };
}

/** Convenience: one-liner factory for the canonical `channel` factory
 *  {@link implementSurfaceOnPublisher} takes, backed by a private
 *  `inMemoryPublisher`. Hides the two-step
 *  `const publisher = inMemoryPublisher(); (name) =>
 *  publisherChannel(publisher, name)` cassette. This IS what the ordinary
 *  {@link implementSurface} owns internally, so pass it EXPLICITLY only to
 *  `implementSurfaceOnPublisher` — i.e. when the factory must be SHARED with
 *  another concern (the cell fold in `reServeSurface`, a cross-cell publish):
 *
 *  ```ts
 *  const channel = inMemoryChannelByName();
 *  implementSurfaceOnPublisher(surface, deps, channel);
 *  ```
 *
 *  Use `inMemoryPublisher` + `publisherChannel` directly when you
 *  need the publisher reference for something else (cross-cell
 *  publishes, instrumentation, etc.); reach for this helper for the
 *  90% case where you just want named in-process channels.
 *
 *  Pass `channelOpts` to bound EACH per-name channel's per-subscriber receive
 *  queue (see {@link InMemoryChannelOptions}) — omit for the unbounded default. */
export function inMemoryChannelByName(
  channelOpts: InMemoryChannelOptions = {},
): <T>(name: string) => Channel<T> {
  const publisher = inMemoryPublisher(channelOpts);
  return <T>(name: string) => publisherChannel<T>(publisher, name);
}

/** Snapshot-then-delta observable cell. Combines a value (read via
 *  `current()`, written via `set()`) with a `Channel<T>` interface
 *  that fires `onEvent(current)` *synchronously* on consume before
 *  forwarding subsequent `set()` calls.
 *
 *  Use case: any in-process mutable state observers want to track with
 *  the same snapshot-then-delta contract `useCell` already gives wire
 *  consumers. The demo's `HostSession.onState(cb)` is the canonical
 *  example — without this, every such observer hand-rolls a
 *  `Set<callback>` plus a synchronous initial fire, and every variant
 *  is a chance for the initial fire to be forgotten.
 *
 *  Distinct from `inMemoryStore<T>` (read/write only, no observation)
 *  and `inMemoryChannel<T>` (observation only, no current value). The
 *  conjunction is the useful primitive.
 *
 *  `publish(v)` is an alias for `set(v)` so the cell still satisfies
 *  the `Channel<T>` interface that `implementSurface` expects when one
 *  is passed as the `channel:` dep — meaning the same cell can serve
 *  in-process observers AND back a framework-managed surface cell.
 *
 *  `get()` is an alias for `current()` so the cell also satisfies the
 *  `CellStore<T>` interface — one read/write store shape across the whole
 *  cell path (no rename adapter needed when handing the cell's store into a
 *  `CellStore`-typed slot). */
export function inMemoryCell<T>(initial: T): Channel<T> &
  CellStore<T> & {
    current(): T;
  } {
  let value = initial;
  const deltas = inMemoryChannel<T>();
  return {
    current: () => value,
    get: () => value,
    set: (v) => {
      value = v;
      deltas.publish(v);
    },
    publish: (v) => {
      value = v;
      deltas.publish(v);
    },
    subscribe: (signal) => deltas.subscribe(signal),
    consume: ({ onEvent, onError }) => {
      // Snapshot first — the consumer sees the initial state before
      // any deltas could possibly arrive.
      onEvent(value);
      return deltas.consume({ onEvent, onError });
    },
  };
}

/** Build the `consume` half of a `Channel<T>` from its `subscribe` half.
 *  Owns an `AbortController` per subscriber, runs a fire-and-forget loop,
 *  suppresses post-abort errors (those are end-of-life noise, not a real
 *  failure). Identical body for every `Channel<T>` implementation — the
 *  only thing they vary in is `subscribe`. */
function buildConsume<T>(
  subscribe: (signal: AbortSignal | undefined) => AsyncIterable<T>,
): Channel<T>["consume"] {
  return ({ onEvent, onError }) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const value of subscribe(controller.signal)) onEvent(value);
      } catch (err) {
        if (!controller.signal.aborted) onError(err);
      }
    })();
    return () => controller.abort();
  };
}

/** CellStore backed by a `conf`-style key-value store. Reads/writes one
 *  top-level key on the underlying store; the rest of the on-disk shape
 *  is owned by the consumer (so multiple cells can share one Conf with
 *  one migration ladder).
 *
 *  Pass `T` explicitly: `confStore<Preferences>(store, "preferences")`.
 *  The Conf type's overloaded `get` doesn't flow through generic
 *  inference, so the cell value type is supplied at the call site. */
export function confStore<T>(
  conf: { get(key: string): unknown; set(key: string, value: T): void },
  key: string,
): CellStore<T> {
  return {
    get: () => conf.get(key) as T,
    set: (v) => conf.set(key, v),
  };
}

// ── Built-in Channel adapter for @orpc/experimental-publisher ──────

/** Build a `Channel<T>` from an `@orpc/experimental-publisher`-style
 *  publisher. The publisher's untyped string-channel API is hidden
 *  behind a typed bus so each cell has one named channel and consumers
 *  can't typo.
 *
 *  Wraps the underlying iterator with `iterateUntilAborted` for two
 *  reasons. First (correctness): oRPC's WebSocket adapter calls
 *  `peer.close()` when the socket closes, which `AbortController.abort()`s
 *  every in-flight stream's signal — the publisher iterator then rejects
 *  pending pulls with `signal.reason`. Letting that propagate produces a
 *  full DOMException stack on every disconnect; swallowing the
 *  signal-shaped error keeps the cleanup quiet. Second (ordering): the
 *  extra generator layer adds one microtask of delay per yielded event,
 *  which preserves cross-channel ordering when multiple publishes fire
 *  on the same tick. Without that delay, a list-update publish racing
 *  a per-terminal exit publish can deliver the list message first and
 *  the client's `removeAndAutoSwitch` sees an already-truncated list,
 *  picking the wrong active terminal (or null).
 *
 *  Regression-pinned by Kolu's `kill.feature` "Natural PTY exit removes
 *  terminal" e2e scenario: removing the wrapper makes that test time out
 *  on the canvas-visible step. Any future "optimization" that flattens
 *  this layer must keep that test green. */
export function publisherChannel<T>(
  publisher: {
    publish: (channel: string, payload: T) => Promise<void> | void;
    subscribe: (
      channel: string,
      opts: { signal?: AbortSignal },
    ) => AsyncIterable<T>;
  },
  channelName: string,
): Channel<T> {
  const subscribe = (signal: AbortSignal | undefined) =>
    iterateUntilAborted(publisher.subscribe(channelName, { signal }), signal);
  return {
    publish: (value) => {
      void publisher.publish(channelName, value);
    },
    subscribe,
    consume: buildConsume(subscribe),
  };
}

/** The abort-time swallow contract in one predicate: a rejection is
 *  end-of-life noise iff `signal` has aborted and the error *is* its abort
 *  reason (the publisher rejects pending pulls with `signal.reason` on
 *  shutdown). Exported as the single home of that rule so the iteration
 *  swallow (`iterateUntilAborted`) and the projection layer's pre-iteration
 *  `upstream()` / connect-loop swallows (`./project`) all decide "is this
 *  the expected shutdown rejection?" with one body — a fix to the contract
 *  (the kind `kill.feature` pins) lands in exactly one place. */
export function isAbortReason(
  err: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return signal?.aborted === true && err === signal.reason;
}

/** Iterate `source` and yield each item, ending cleanly if the iterator
 *  rejects with the signal's abort reason. Adds one microtask of delay
 *  per yield (see `publisherChannel`'s comment for why that matters).
 *
 *  The single home of the abort-time iterator-teardown contract: a
 *  downstream pull rejected with `signal.reason` on shutdown is end-of-life
 *  noise, swallowed here (via `isAbortReason`) so it never bubbles as an
 *  unhandled rejection. `projectSurface`'s `mapUpstream` composes on top of
 *  this so the per-frame swallow has exactly one definition; a fix to the
 *  abort contract (the kind `kill.feature` pins) lands in one place. */
export async function* iterateUntilAborted<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  try {
    for await (const item of source) yield item;
  } catch (err) {
    if (isAbortReason(err, signal)) return;
    throw err;
  }
}

// ── implementSurface — server-side dep wiring for a Surface ─────────────

/** Per-cell implementation deps. The surface owns the publish channel
 *  (`<key>:changed`, derived from the surface key — not configurable);
 *  the consumer supplies persistence + (when patchSchema is set) the patch
 *  merge fn. */
export type CellImplDeps<S extends CellSpec<unknown, unknown>> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? {
      store: CellStore<T>;
      /** Pure merge for partial mutations. Optional here when the cell's
       *  spec already declares `patch` (the spec wins; the framework
       *  errors at boot if neither is supplied). */
      patch?: (current: T, p: P) => T;
      /** Optional equality predicate. Same resolution rule as `patch`:
       *  spec-declared `equals` wins, deps may override. See
       *  `CellSpec.equals` for semantics. */
      equals?: (a: T, b: T) => boolean;
      onMutate?: (patch: P, current: T) => void;
      /** Fire-and-forget side effect on every successful write. See
       *  `CellHandlerDeps.onWrite`. */
      onWrite?: (next: T) => void;
      /** Write-forwarding seam for a re-serving mirror. See
       *  `CellHandlerDeps.forward`. */
      forward?: CellForward<T, P>;
      /** Mirror-never-fabricate gate. See `CellHandlerDeps.hasSnapshot`. */
      hasSnapshot?: () => boolean;
      /** Optional async-source republish. The runtime fires it ONCE after
       *  the cell is wired, handing it the cell ctx setter (so a late-arriving
       *  value flows through the same equals/onWrite/store.set/bus.publish path)
       *  AND an abort signal. It MAY return a disposer. The connector is an
       *  OWNED SOURCE of the {@link SurfaceRuntime}: a rejection reaches `done`,
       *  and `close()` aborts the signal then runs the disposer. Owned by the
       *  runtime — apps never call it. */
      connect?: CellConnector<T>;
    }
  : S extends { schema: ZodType<infer T> }
    ? {
        store: CellStore<T>;
        equals?: (a: T, b: T) => boolean;
        onMutate?: (next: T, current: T) => void;
        onWrite?: (next: T) => void;
        /** Write-forwarding seam for a re-serving mirror. See
         *  `CellHandlerDeps.forward`. */
        forward?: CellForward<T, T>;
        /** Mirror-never-fabricate gate. See `CellHandlerDeps.hasSnapshot`. */
        hasSnapshot?: () => boolean;
        /** Optional async-source republish. The runtime fires it ONCE after
         *  the cell is wired, handing it the cell ctx setter (so a late-arriving
         *  value flows through the same equals/onWrite/store.set/bus.publish
         *  path) AND an abort signal. It MAY return a disposer. The connector is
         *  an OWNED SOURCE of the {@link SurfaceRuntime}: a rejection reaches
         *  `done`, and `close()` aborts the signal then runs the disposer. Owned
         *  by the runtime — apps never call it. */
        connect?: CellConnector<T>;
      }
    : never;

/** Per-collection implementation deps. The surface owns both buses
 *  (`<key>:keys` and `<key>:key:<k>`, derived from the surface key — not
 *  configurable) and wraps `upsert`/`remove` so every persisted change
 *  publishes through the surface's channels — the consumer's upsert/remove
 *  are persistence-only. Side-effects (`scheduleAutosave`, etc.) belong
 *  inside the consumer's upsert/remove fns or in the imperative procedure
 *  that triggered the call. */
export type CollectionImplDeps<S extends CollectionSpec<unknown, unknown>> =
  S extends { keySchema: ZodType<infer K>; schema: ZodType<infer T> }
    ? {
        readAll: () => Map<K, T>;
        readOne?: (key: K) => T | undefined;
        upsert: (key: K, value: T) => void;
        remove: (key: K) => void;
      }
    : never;

/** Per-stream implementation deps. A stream is either:
 *
 *  - **Poll-on-event** (the common case for external mutable state — git,
 *    fs): supply `{ read, install, isEqual }` and the framework synthesizes
 *    `pollOnEvent` internally. Snapshot-then-deltas is preserved by
 *    construction; `onReadError` for subsequent-read failures defaults to
 *    `implementSurface(...).onStreamReadError`.
 *  - **Raw async iterator**: supply `{ source }` directly when the source
 *    isn't shaped as poll-on-event (e.g. a long-poll bidirectional stream,
 *    or a custom snapshot computation). The author owns snapshot-then-
 *    deltas; the framework yields whatever the iterator yields.
 *
 *  The two shapes are a discriminated union — supplying both is a type
 *  error. */
export type StreamImplDeps<S extends StreamSpec<unknown, unknown>> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ?
      | {
          source: (
            input: I,
            signal: AbortSignal | undefined,
          ) => AsyncIterable<T>;
        }
      | {
          /** Read current value for `input`. Yielded as the snapshot first
           *  frame; re-invoked on every event tick from `install`. */
          read: (input: I) => Promise<T>;
          /** Install a "something changed" listener for `input`. The
           *  callback is invoked on each potential change; the framework
           *  re-reads and yields only when `isEqual(last, next)` is false.
           *  Returns an unsubscribe fn. */
          install: (input: I, onEvent: () => void) => () => void;
          /** Equality predicate to suppress redundant yields. */
          isEqual: (a: T, b: T) => boolean;
          /** Subsequent-read error handler. Defaults to
           *  `implementSurface(...).onStreamReadError` when omitted. The
           *  initial read's error always propagates (the client has no
           *  snapshot yet). */
          onReadError?: (err: unknown) => void;
        }
  : never;

/** Per-event implementation deps. The surface owns the per-input event
 *  channel (default name `<key>:<key-of-input>` where the key-of-input is
 *  `String(input)` for primitives and `JSON.stringify(input)` for objects).
 *
 *    - Domain code publishes via `ctx.events.<key>.publish(input, payload)`,
 *      which writes to that channel.
 *    - The wire handler reads from the same channel.
 *
 *  `source` is optional. The default reads from the channel forever; supply
 *  one when the read path needs pre-subscribe validation, single-yield-then-
 *  close, or any other shape. The supplied source receives `helpers.bus` —
 *  the same channel `ctx.publish` writes to — so it doesn't reference a
 *  channel name string. */
export type EventImplDeps<S extends EventSpec<unknown, unknown>> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? {
      source?: (
        input: I,
        signal: AbortSignal | undefined,
        helpers: { bus: Channel<T> },
      ) => AsyncIterable<T>;
    }
  : never;

// ── Procedure ctx ──────────────────────────────────────────────────────

/** Per-cell procedure ctx — get/set/patch via the surface's wrapped helpers
 *  so imperative procedures publish through the same channel as the wire
 *  handlers. Bypassing this and writing directly to the consumer's store
 *  silently skips the publish; don't. */
/** `set`'s optional `{ force }` bypasses the cell's `equals` dedup for that ONE
 *  write (a re-serve's rebind epoch republishes an equal value — #1681); omitted,
 *  the write dedups as before. Exported as the ONE source of truth for the opts
 *  shape so a cross-package consumer (`reServeSurface`'s cell fold) references it
 *  instead of hand-copying a narrowed cast that would drift silently. */
export type CellCtxSetOpts = { force?: boolean };
type CellCtxSet<T> = (v: T, opts?: CellCtxSetOpts) => void;
type CellCtxFor<S> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? { get: () => T; set: CellCtxSet<T>; patch: (p: P) => void }
  : S extends { schema: ZodType<infer T> }
    ? { get: () => T; set: CellCtxSet<T> }
    : never;

type CollectionCtxFor<S> = S extends {
  keySchema: ZodType<infer K>;
  schema: ZodType<infer T>;
}
  ? {
      upsert: (k: K, v: T) => void;
      remove: (k: K) => void;
      readAll: () => Map<K, T>;
      readOne: (k: K) => T | undefined;
    }
  : never;

/** Per-event ctx — `publish(input, payload)` writes to the framework-derived
 *  channel that the event's handler subscribes to. The channel name is
 *  `<key>:<key-of-input>` where the key-of-input is `String(input)` for
 *  primitives or `JSON.stringify(input)` for objects. Domain code never
 *  sees the channel string. */
type EventCtxFor<S> = S extends {
  inputSchema: ZodType<infer I>;
  outputSchema: ZodType<infer T>;
}
  ? { publish: (input: I, payload: T) => void }
  : never;

export type SurfaceCtx<S extends SurfaceSpec> = {
  cells: {
    [K in keyof S["cells"] & string]: CellCtxFor<NonNullable<S["cells"]>[K]>;
  };
  collections: {
    [K in keyof S["collections"] & string]: CollectionCtxFor<
      NonNullable<S["collections"]>[K]
    >;
  };
  events: {
    [K in keyof S["events"] & string]: EventCtxFor<NonNullable<S["events"]>[K]>;
  };
};

/** Handler for an imperative procedure. Receives `ctx` exposing the
 *  surface's cell/collection mutation helpers so cross-descriptor publishes
 *  (e.g. `notes.create` writing to the `notes` collection) go through the
 *  same channels the wire handlers do. */
export type ProcedureImpl<
  S extends ProcedureSpec<unknown, unknown>,
  Ctx,
> = S extends { input: ZodType<infer I>; output: ZodType<infer O> }
  ? (opts: { input: I; ctx: Ctx; signal?: AbortSignal }) => Promise<O> | O
  : S extends { input: ZodType<infer I> }
    ? (opts: {
        input: I;
        ctx: Ctx;
        signal?: AbortSignal;
      }) => Promise<void> | void
    : S extends { output: ZodType<infer O> }
      ? (opts: { ctx: Ctx; signal?: AbortSignal }) => Promise<O> | O
      : (opts: { ctx: Ctx; signal?: AbortSignal }) => Promise<void> | void;

// ── ImplementSurfaceDeps ────────────────────────────────────────────────

/** A cell's implementation dep: an ordinary {@link CellImplDeps} (its own store,
 *  or a graph-node `derived.cell(node)` — which is structurally a `CellImplDeps`
 *  with a `connect`), OR the compute-fn `derived.cell(($) => …)` carrier, whose
 *  `S` phantom flows the surface's sibling types back to the `$` parameter at the
 *  declaration site. The compute arm drops `connect`/`dispose`/`bindSiblings` — the
 *  runtime reads those off the branded value directly; keeping the callback
 *  `connect` in the union would de-contextualize a plain cell dep's own `connect`
 *  callback (its `cell` param would infer `any`). What survives carries what the
 *  slot needs: the brands, the `store` (its `T` validates the compute's return
 *  against the cell schema), and the `S` phantom. */
type CellDepFor<
  S extends SurfaceSpec,
  C extends CellSpec<unknown, unknown>,
> = C extends {
  schema: ZodType<infer T>;
}
  ?
      | CellImplDeps<C>
      | Omit<DerivedComputeCell<S, T>, "connect" | "dispose" | "bindSiblings">
  : CellImplDeps<C>;

export interface ImplementSurfaceDeps<S extends SurfaceSpec> {
  /** Default subsequent-read error handler for poll-shape streams (those
   *  declared with `{ read, install, isEqual }` rather than a raw `source`).
   *  Per-stream `onReadError` overrides this. The initial read's error
   *  always propagates regardless. Required when at least one poll-shape
   *  stream omits its own `onReadError`; pass `() => {}` to opt into
   *  silent-skip explicitly. */
  onStreamReadError?: (err: unknown, info: { stream: string }) => void;

  cells?: {
    [K in keyof S["cells"] & string]: CellDepFor<S, NonNullable<S["cells"]>[K]>;
  };
  collections?: {
    [K in keyof S["collections"] & string]: CollectionImplDeps<
      NonNullable<S["collections"]>[K]
    >;
  };
  streams?: {
    [K in keyof S["streams"] & string]: StreamImplDeps<
      NonNullable<S["streams"]>[K]
    >;
  };
  events?: {
    [K in keyof S["events"] & string]: EventImplDeps<
      NonNullable<S["events"]>[K]
    >;
  };
  procedures?: {
    [K in keyof S["procedures"] & string]: {
      [V in keyof NonNullable<S["procedures"]>[K] & string]: ProcedureImpl<
        NonNullable<S["procedures"]>[K][V],
        SurfaceCtx<S>
      >;
    };
  };
}

// ── Supervision: SurfaceRuntime / owned sources ─────────────────────────

/** A teardown callback returned by an async cell connector — the framework
 *  calls it during {@link SurfaceRuntime.close}. Sync or async. */
export type Disposer = () => void | Promise<void>;

/** A cell connector: the async-source republish hook the runtime fires once after
 *  wiring a cell. It receives the cell's private setter and an abort signal, and
 *  MAY return a {@link Disposer} (sync or async). The `void` arm is load-bearing,
 *  not confusing — a `void`-returning `async` connector produces `Promise<void>`,
 *  which the async arm must accept.
 *
 *  Cancellation: `close()` aborts the signal. A connector that awaits abortable
 *  work with it (`await fetch(url, { signal })`, the package's own
 *  `Channel.subscribe`, …) and rejects with the signal's reason is treated as a
 *  clean cancellation — that abort-caused rejection is swallowed, not an owned
 *  fault, so a clean close resolves `done`. A GENUINE (non-abort) rejection is an
 *  owned fault and reaches `done`. */
export type CellConnector<T> = (
  cell: { set: (next: T) => void },
  opts: { signal: AbortSignal },
  // biome-ignore lint/suspicious/noConfusingVoidType: the void arm is required so a void-returning async connector's Promise<void> is assignable; see the doc above.
) => void | Disposer | Promise<void | Disposer>;

/** One supervised, owned async source of a served surface — today a cell
 *  connector (the `connect` seam). Its `settled` reaching a rejection is an
 *  OWNED FAULT that must reach `done`; `close()` aborts it (signal
 *  cancellation), awaits its settlement, then runs its disposer — the #1719
 *  ownership doctrine (abort first, then observe the settle) applied at the
 *  runtime seam. */
interface SurfaceSource {
  /** Signal cancellation to the source (idempotent). */
  abort(): void;
  /** Resolves when the source's `connect` call settled; rejects if it faulted. */
  settled: Promise<void>;
  /** Release the source's held resources (its returned disposer). */
  dispose(): Promise<void>;
}

/** A deferred connector START — a thunk the walk collects but does NOT invoke.
 *  Construction is transactional: the walk validates EVERY member (and the caller
 *  builds the final router) BEFORE any thunk runs, so a later missing dep or a
 *  router-assembly throw can never leave an earlier connector already spun up with
 *  no abort owner / no fault observer. Invoking the thunk starts the connector and
 *  returns its supervised {@link SurfaceSource}. */
type SurfaceSourceStart = () => SurfaceSource;

/** Wire a set of owned sources into the `done` / `close` supervision contract.
 *
 *  - `done` rejects the instant ANY source faults before `close` (an owned
 *    fault reaches `done` rather than floating as an unhandled rejection), and
 *    resolves once a clean `close` has torn everything down.
 *  - `close` is idempotent and always resolves (teardown is harmless to repeat):
 *    it aborts every source FIRST, then runs each source's settle-then-dispose
 *    sequence INDEPENDENTLY and concurrently (so a still-parked source's
 *    rejection is observed, never abandoned — #1719, and a parked source blocks
 *    only its own dispose, never a sibling's release). A fault seen during
 *    teardown — a settle rejection OR a disposer rejection — is routed to
 *    `done`, not thrown from `close`. */
function superviseSurface(sources: SurfaceSource[]): {
  done: Promise<void>;
  close: () => Promise<void>;
} {
  let resolveDone!: () => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  let closing: Promise<void> | undefined;
  // A source that faults BEFORE close reaches `done` immediately as a rejection —
  // the FIRST such fault is the root cause (`done` is settle-once by spec, so a
  // later one is a no-op). Once `close` has begun, though, it stands down: its
  // own barrier below is then the SOLE settler, so it can AGGREGATE every
  // teardown fault instead of losing all but the first to this eager race. The
  // `.catch` still runs (the rejection never floats unhandled), it just doesn't
  // settle `done` during close.
  for (const s of sources)
    s.settled.catch((err) => {
      if (!closing) rejectDone(err);
    });

  const close = (): Promise<void> => {
    closing ??= (async () => {
      // Abort every source FIRST, then run each source's own
      // settle-then-dispose sequence INDEPENDENTLY (not behind a global
      // settlement barrier): a source that ignores cancellation blocks only its
      // OWN dispose, never a sibling's resource release. Each sequence still
      // observes the settle before disposing (#1719 abort-then-observe), and
      // BOTH a settle fault AND a dispose fault are OWNED teardown faults that
      // must reach `done` — so the per-source task rethrows whichever it saw
      // (the settle fault first, as the earlier root cause).
      for (const s of sources) s.abort();
      const outcomes = await Promise.allSettled(
        sources.map(async (s) => {
          let settleFault: { reason: unknown } | undefined;
          try {
            await s.settled;
          } catch (err) {
            settleFault = { reason: err };
          }
          // Always release the source's held resources, even if its settle
          // faulted — a fault must not strand a disposer. A dispose rejection
          // propagates out of this task (an owned teardown fault → `done`).
          await s.dispose();
          if (settleFault) throw settleFault.reason;
        }),
      );
      // Surface EVERY teardown fault, not just the first: with the eager catch
      // stood down (above), this barrier is the sole settler during close, so a
      // second concurrently-faulting source is never silently dropped. One fault
      // rejects with its own reason (byte-identical to a single-source fault);
      // several aggregate so each is diagnosable.
      const faults = outcomes
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);
      if (faults.length === 0) resolveDone();
      else if (faults.length === 1) rejectDone(faults[0]);
      else
        rejectDone(
          new AggregateError(faults, "surface runtime teardown faulted"),
        );
    })();
    return closing;
  };
  return { done, close };
}

/** The supervision contract shared by every servable surface runtime — one
 *  axis (router + ctx + done + close) parameterized over its ctx shape, so the
 *  singular and plural runtimes below differ only in `Ctx`, never in the
 *  supervision members. The `router` is FINAL (no consumer re-finalizes the
 *  surface via oRPC `implement`); `done` rejects on an owned runtime fault (a
 *  cell connector rejecting) and resolves on a clean `close`; `close` releases
 *  every owned source and is idempotent. */
export interface SurfaceRuntimeHandle<Ctx> {
  /** The FINAL top-level oRPC router — ready for `RPCHandler` / `serveOverStdio`
   *  / `directLink`, or to spread beside a consumer's own raw namespaces. */
  readonly router: unknown;
  /** The typed cells/collections/events mutation ctx (domain writes). */
  readonly ctx: Ctx;
  /** Rejects on an owned runtime fault; resolves on a clean {@link close}. A
   *  serving site MUST observe this and route it into its existing failure
   *  policy. */
  readonly done: Promise<void>;
  /** Release every owned source (cell-connector disposers). Idempotent. */
  close(): Promise<void>;
}

/** A directly servable, supervised surface runtime — the return of
 *  {@link implementSurface} / {@link implementSurfaceOnPublisher}. `ctx` is the
 *  single surface's mutation ctx. */
export interface SurfaceRuntime<S extends SurfaceSpec>
  extends SurfaceRuntimeHandle<SurfaceCtx<S>> {}

/** The plural sibling of {@link SurfaceRuntime} — the return of
 *  {@link implementSurfaces} / {@link implementSurfacesOnPublisher}. `ctx` is
 *  keyed per sibling surface; `router`/`done`/`close` supervise the whole map. */
export interface SurfacesRuntime<S extends SurfaceMap>
  extends SurfaceRuntimeHandle<SurfacesCtx<S>> {}

/** Build the full server router from a surface + dep wiring. Replaces the
 *  hand-listed `t.X.<verb>.handler(handlers.<verb>)` plumbing for every
 *  cell, collection, stream, event, and imperative procedure declared in
 *  the surface.
 *
 *  Channel naming is surface-driven and not configurable: cells use
 *  `"<key>:changed"`, collections use `"<key>:keys"` + `"<key>:deltas"` +
 *  `"<key>:key:" + String(k)` (see `./channelNames.ts` — the sole source of
 *  these names), events use `"<key>:" + eventChannelKey(input)`. Renaming a
 *  surface key thus renames the channel — for cells whose channels back
 *  persisted subscriptions, prefer adding a new key and migrating off the
 *  old one.
 *
 *  Returns a supervised `SurfaceRuntime` `{ router, ctx, done, close }`.
 *  `router` is the FINAL top-level router — serve it directly (no re-finalize
 *  via oRPC `implement`). To sit a surface beside raw-oRPC procedures the
 *  surface can't model (custom `onRetry`, binary framing, subscribe-before-
 *  yield), spread the built router's own `surface` namespaces into an assembled
 *  object rather than re-running `implement`; use `ctx` from domain code for
 *  typed mutations.
 */
/** Walk a single surface's spec and wire every cell/collection/stream/event/
 *  procedure onto `root` — the oRPC builder node *at the surface root* (i.e.
 *  `implement(contract).surface` for a lone surface, or
 *  `implement(combined).surface[key]` for a keyed sibling). Returns the
 *  per-key handler namespaces (to feed `root.router(...)` /
 *  `t.router({ [key]: namespaces })`) plus the typed mutation `ctx`.
 *
 *  Shared by `implementSurface` (singular) and `implementSurfaces` (plural)
 *  so the two paths can never drift on how a primitive is wired.
 *
 *  `channel` is supplied by the constructor, NOT by the public deps: the
 *  ordinary constructor owns an internal `inMemoryChannelByName()`, and the
 *  `*OnPublisher` constructor injects the caller's shared channel. So the walk
 *  takes the public deps PLUS the resolved channel factory. */
function walkSurface<const S extends SurfaceSpec>(
  // biome-ignore lint/suspicious/noExplicitAny: the oRPC builder node is too dynamic for our runtime walk; spec types carry call-site safety.
  root: any,
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S> & {
    channel: <T>(name: string) => Channel<T>;
  },
  identity?: BakedIdentity,
): {
  namespaces: Record<string, Record<string, unknown>>;
  ctx: SurfaceCtx<S>;
  starts: SurfaceSourceStart[];
} {
  const spec = surface.spec;

  const cellsCtx: Record<string, unknown> = {};
  const collectionsCtx: Record<string, unknown> = {};
  const namespaces: Record<string, Record<string, unknown>> = {};
  // Deferred STARTS for the owned async sources this surface declares (today:
  // cell connectors). Collected here but NOT invoked — the caller starts them
  // only after the whole surface (and, for a sibling map, every sibling + the
  // final router) validates, so construction is transactional. The returned
  // runtime supervises the started sources via `done` / `close`.
  const starts: SurfaceSourceStart[] = [];

  // ── Reactor sibling-read (`$`) machinery ───────────────────────────────
  // A compute-fn `derived.cell(($) => …)` reads its siblings through `$`. The
  // walk bridges each cell/collection into the graph with a plain
  // `SiblingSource`: `read()` returns the sibling's CURRENT value, and
  // `subscribe(cb)` registers a synchronous change edge fired by the sibling's
  // post-equals write. The walk never touches a signal — `reactor.ts` wraps each
  // source in a version signal when a compute cell binds, so the engine stays
  // reachable only through the reactor.
  //
  // A `siblingChange[key]` fan-out is the "post-equals mirror poke": the
  // bridge-owned store wrapper both cell write paths pass through calls it AFTER
  // the value lands (so only accepted writes fire), and the wrapped collection
  // publishers call it on every key change — a missed poke is unwritable by
  // construction, not a rider held by pinning tests.
  const siblingSources: SiblingSourcesRuntime = {};
  const siblingChange: Record<string, () => void> = {};
  // A cell/collection registers its live read + change fan-out here. Subscribers
  // are held per key; `subscribe` returns an unsubscribe the compute cell runs on
  // dispose.
  const registerSibling = (key: string, read: () => unknown): void => {
    const subscribers = new Set<() => void>();
    siblingSources[key] = {
      read,
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      },
    } satisfies SiblingSource;
    siblingChange[key] = () => {
      for (const cb of subscribers) cb();
    };
  };
  // Compute cells cannot build their node until every sibling source exists (a
  // sibling collection is walked AFTER the cells), so their bind + eager seed is
  // deferred to one pass after both loops.
  const bindComputeCells: Array<(sources: SiblingSourcesRuntime) => void> = [];

  // ── Cells ────────────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    const bus = deps.channel<unknown>(`${key}:changed`);
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const cellDeps = (deps.cells as any)?.[key] as
      | {
          store: CellStore<unknown>;
          patch?: (c: unknown, p: unknown) => unknown;
          equals?: (a: unknown, b: unknown) => boolean;
          onMutate?: (p: unknown, c: unknown) => void;
          onWrite?: (next: unknown) => void;
          forward?: CellForward<unknown, unknown>;
          hasSnapshot?: () => boolean;
          // The connector's ONE source of truth — a full `CellConnector`
          // (abort signal + optional `Disposer`), not a re-declared narrower
          // shape that a later cast would have to correct.
          connect?: CellConnector<unknown>;
        }
      | undefined;
    if (!cellDeps) {
      throw new Error(`implementSurface: missing deps for cell "${key}"`);
    }
    // Boot narrowing for a reactor `derived.cell(...)`: the graph is the
    // member's ONE writer, so a derived cell is wire-read-only BY CONSTRUCTION.
    // Crash loudly if it declares any write verb (`set`/`patch`/`test__set`) —
    // a second writer is a defect, not a knob, and this makes it a boot crash
    // rather than a silent double-writer. The derived value still reaches the
    // wire through the `connect` seam below; `get` is its only exposed verb.
    if (isDerivedCellDeps(cellDeps)) {
      const writeVerbs = resolveCellVerbs(cellSpec).filter((v) => v !== "get");
      if (writeVerbs.length > 0) {
        throw new Error(
          `implementSurface: derived cell "${key}" is wire-read-only (its derivation is the one writer) but declares write verb(s) [${writeVerbs.join(", ")}] — declare verbs: ["get"] (test__set included).`,
        );
      }
    }
    // Mirror-never-fabricate, fail-fast: a write-forwarding cell (a re-serve
    // mirror — the ONLY producer of `forward`) MUST carry the `hasSnapshot` gate,
    // or `cellHandlers.get` would fall back to `?? true` and serve the seeded
    // default as if the authority had sent it — the exact fabrication the gate
    // exists to forbid. Crash at boot rather than let the impossible state ship.
    if (cellDeps.forward && !cellDeps.hasSnapshot) {
      throw new Error(
        `implementSurface: forwarding cell "${key}" must declare a hasSnapshot gate (mirror-never-fabricate) — a mirror serves no frame until the authority's first fold. See CellHandlerDeps.hasSnapshot.`,
      );
    }
    // Spec-declared `patch` wins; deps may override (rare). Cells with
    // `patchSchema` need one or the other — error loudly if both are
    // missing rather than silently accepting full-replacement semantics.
    const patchFn = cellSpec.patch ?? cellDeps.patch;
    if (cellSpec.patchSchema && !patchFn) {
      throw new Error(
        `implementSurface: cell "${key}" has patchSchema but no patch fn (declare on spec or pass via deps)`,
      );
    }
    // Spec-declared `equals` wins; deps may override (rare). Same
    // resolution rule as `patch`.
    const equalsFn = cellSpec.equals ?? cellDeps.equals;
    const onWriteFn = cellDeps.onWrite;
    // A derived cell's PUBLIC `store` is a read-only, stateless facade (its `get`
    // pulls the graph node's current level, its `set` throws — the graph is the one
    // writer). The dep carries NO writable store, so nothing a holder can reflect off
    // it can poison the wire snapshot. `implementSurface` builds and OWNS the private
    // serving store here — seeded from the facade's `get` (the node's current level) —
    // and drives it exclusively through the `connect` seam below, so `cellHandlers.get`
    // and `ctxApply` read/write this closure-private store, never anything on the dep.
    // A non-derived cell uses its own `store` directly.
    //
    // A COMPUTE-fn derived cell's node does not exist until `bindSiblings` (a
    // sibling collection is walked AFTER the cells), so its facade `get` throws
    // before bind. Seed the private store with the spec DEFAULT as a placeholder
    // and re-seed it (eager pull) in the deferred bind pass below, before any
    // handler can read it — no wire reader exists until the runtime starts.
    const isComputeCell = isDerivedComputeCellDeps(cellDeps);
    const rawStore: CellStore<unknown> = isDerivedCellDeps(cellDeps)
      ? inMemoryStore(isComputeCell ? cellSpec.default : cellDeps.store.get())
      : cellDeps.store;
    // The BRIDGE-OWNED store wrapper both cell write paths land in: `set` writes
    // the value, then fires this cell's post-equals change edge (the "mirror
    // poke"). `applyAndPublish` and `ctxApply` both check `equals` BEFORE calling
    // `set`, so the poke is POST-equals by construction — a suppressed write never
    // pokes, and a third write path would poke for free. Reads pass straight
    // through. `siblingChange[key]` is populated by `registerSibling` just below.
    const store: CellStore<unknown> = {
      get: () => rawStore.get(),
      set: (next) => {
        rawStore.set(next);
        siblingChange[key]?.();
      },
    };
    // Expose this cell to `$`: a sibling read returns its CURRENT (post-equals)
    // value; its change edge is the store wrapper above.
    registerSibling(key, () => store.get());
    // Defer a compute cell's node build + eager seed until every sibling source
    // exists (after both loops). `bindSiblings` builds the node; the eager pull
    // re-seeds the private store (a throw is a boot crash — mirror-never-fabricate)
    // WITHOUT firing the poke (a seed is not a change; no subscriber exists yet).
    if (isComputeCell) {
      const computeDeps = cellDeps as unknown as DerivedComputeCell<
        SurfaceSpec,
        unknown
      >;
      bindComputeCells.push((sources) => {
        computeDeps.bindSiblings(sources);
        rawStore.set(computeDeps.store.get());
      });
    }
    const handlers = cellHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.cells as any)[key] as Cell<string, unknown>,
      {
        store,
        bus,
        patch: patchFn,
        equals: equalsFn,
        onMutate: cellDeps.onMutate,
        onWrite: onWriteFn,
        forward: cellDeps.forward,
        hasSnapshot: cellDeps.hasSnapshot,
      },
    );

    // Server-internal `ctx.cells.<key>.set/patch` — same dedup/onWrite
    // gates as the wire-facing handlers so an internal write goes
    // through the same atomicity contract (e.g. an in-app
    // `setSavedSession` cancels the autosave timer via `onWrite`, and
    // a no-op republish is suppressed by `equals`).
    //
    // Intentionally does NOT call `onMutate`: that hook is the
    // wire-only client-action audit point, scoped to `set`/`patch`
    // verbs. Server-internal callers are domain code and don't have
    // a meaningful "patch payload before merge" to log — they already
    // know what they're writing.
    //
    // Mirrors the equals→onWrite→store.set→bus.publish sequence in
    // `cellHandlers.applyAndPublish`. Kept duplicated rather than
    // extracted to a shared helper so the two paths diverge loudly
    // (TypeScript errors / test failures) if anyone adds a step to
    // only one side. (`store` — resolved above — is a derived cell's private
    // writable backing, or a non-derived cell's own store.)
    // `force` bypasses the `equals` dedup for ONE write — a re-serve's rebind epoch
    // uses it so a fresh spawn re-confirming a value EQUAL to the pre-drain one still
    // republishes, letting a downstream holder tell "rebound and confirmed" from
    // "stale" (#1681; `reServeSurface`'s cell fold). Steady-state dedup is unchanged:
    // only the explicit `force` caller opts out, per write.
    function ctxApply(next: unknown, opts?: CellCtxSetOpts): void {
      if (!opts?.force && equalsFn?.(store.get(), next)) return;
      onWriteFn?.(next);
      store.set(next);
      bus.publish(next);
    }
    // The write arm (`set`/`patch`) as its own object. The `connect` seam gets it
    // PRIVATELY (below) so the graph — a derived cell's ONE writer — can push
    // through the member's write gate, WITHOUT that setter also landing on the
    // procedure-handler-visible `ctx.cells.<key>`.
    const writeArm = {
      set: ctxApply,
      ...(patchFn
        ? {
            patch: (p: unknown) => {
              ctxApply(patchFn(store.get(), p));
            },
          }
        : {}),
    };
    // A derived cell is wire-read-only AND server-internal-read-only: the graph
    // is its one writer, and it reaches the store ONLY through `connect` (the
    // private `writeArm` below). So a derived cell's `ctx.cells.<key>` exposes `get`
    // plus a THROWING `set`/`patch` — a fail-fast one-writer guard, not a live write
    // path. Keeping the setters PRESENT (throwing) rather than absent makes the ctx
    // TYPE honest: `CellCtxFor` promises `set`/`patch`, and a procedure handler that
    // calls one gets a loud "graph-owned (one writer)" error, never a second writer
    // publishing a value the graph never derived and never a bare "set is not a
    // function". Non-derived cells keep their real server-internal writers.
    const derivedWriteGuard = (): never => {
      throw new Error(
        `implementSurface: cell "${key}" is graph-owned (a derived cell) — the graph is its one writer; ctx.cells.${key}.set/patch is not a write path.`,
      );
    };
    cellsCtx[key] = isDerivedCellDeps(cellDeps)
      ? {
          get: () => store.get(),
          set: derivedWriteGuard,
          ...(patchFn ? { patch: derivedWriteGuard } : {}),
        }
      : { get: () => store.get(), ...writeArm };

    // Optional async-source republish: fire once after the cell ctx is
    // wired, handing it the PRIVATE write arm so a late-arriving value (and a
    // derived cell's graph pushes) flows through the same
    // equals/onWrite/store.set/bus.publish path — without exposing `set` on a
    // derived cell's public ctx.
    //
    // The connector is now an OWNED SOURCE (not fire-and-forget): it receives an
    // abort signal and MAY return a disposer, and its settle is tracked so a
    // fault reaches the runtime's `done` (never floats) and `close` aborts +
    // disposes it. A `void`-returning connector keeps working unchanged.
    if (cellDeps.connect) {
      const connect = cellDeps.connect;
      // DEFER the start: collect a thunk rather than firing the connector here,
      // so an invalid LATER member (or a router-assembly throw upstream) can
      // never leave this connector spun up with no abort owner / no fault
      // observer. The caller invokes the thunk only after the whole surface —
      // and, for a sibling map, every sibling plus the final router — has
      // validated.
      starts.push(() => {
        const ctl = new AbortController();
        let disposer: Disposer | undefined;
        const settled = (async () => {
          try {
            const d = await connect(writeArm, { signal: ctl.signal });
            if (typeof d === "function") disposer = d;
          } catch (err) {
            // A rejection CAUSED by our own abort — `close()` aborted the signal
            // and a signal-respecting connector cooperatively rejected with
            // `signal.reason` (`await fetch({ signal })`, the package's own
            // `Channel.subscribe`, etc.) — is expected end-of-life noise, NOT an
            // owned fault. Swallow it through the canonical `isAbortReason` (the
            // same rule `iterateUntilAborted` / `deriveCell` use) so a clean
            // close resolves `done` (#1719). A GENUINE (non-abort) rejection —
            // the connector faulting on its own — still propagates and reaches
            // `done`.
            if (isAbortReason(err, ctl.signal)) return;
            throw err;
          }
        })();
        return {
          abort: () => ctl.abort(),
          settled,
          dispose: async () => {
            await disposer?.();
          },
        };
      });
    }

    const verbs = resolveCellVerbs(cellSpec);
    const ns: Record<string, unknown> = {};
    for (const v of verbs) {
      // biome-ignore lint/suspicious/noExplicitAny: handler map indexed by verb string
      const h = (handlers as any)[v];
      if (h === undefined) continue;
      ns[v] = root[key][v].handler(h);
    }
    namespaces[key] = { ...(namespaces[key] ?? {}), ...ns };
  }

  // ── Collections ──────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.collections ?? {})) {
    const collSpec = rawSpec as CollectionSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const collDeps = (deps.collections as any)?.[key] as
      | {
          readAll: () => Map<unknown, unknown>;
          readOne?: (k: unknown) => unknown;
          upsert: (k: unknown, v: unknown) => void;
          remove: (k: unknown) => void;
        }
      | undefined;
    if (!collDeps) {
      throw new Error(`implementSurface: missing deps for collection "${key}"`);
    }
    const keysBus = deps.channel<unknown[]>(collectionKeysetChannel(key));
    const perKeyBus = (k: unknown) =>
      deps.channel<unknown>(collectionKeyChannel(key, String(k)));

    // The batched `deltas` stream is OPT-IN: its bus and per-tick coalescing
    // exist only when the collection lists the `deltas` verb. A non-opted
    // collection pays nothing here — the per-key `keys`/`get` path is untouched.
    const collVerbs = resolveCollectionVerbs(collSpec);
    const hasDeltas = collectionHasDeltas(collSpec);
    const deltasBus = hasDeltas
      ? deps.channel<CollectionDelta<unknown, unknown>>(
          collectionDeltasChannel(key),
        )
      : undefined;
    // The per-tick coalescer owns the `pending` buffer + microtask flush; it
    // exists ONLY when the collection opts into `deltas`, so `hasDeltas` is the
    // single representation of "deltas is on" and the walk loop holds no
    // batching state. `coalescer?.upsert`/`.remove` below are the only gate.
    const coalescer = deltasBus
      ? createTickCoalescer<unknown, unknown>(deltasBus)
      : undefined;

    // Surface-owned publish: every upsert broadcasts the new per-key value, and
    // an upsert that ADDS a key (or any remove) broadcasts the new key set.
    // Consumers' upsert/remove stay persistence-only. The deltas coalescing is
    // additive on top.
    //
    // `keysBus` fires on MEMBERSHIP change only — the contract its dep doc states
    // ("broadcasts K[] snapshots on add/remove"). BOTH mirror paths enforce that
    // symmetrically against `broadcastKeys`: `wrappedUpsert` publishes only when a
    // key is NEW to the set, and `wrappedRemove` only when the key was actually IN
    // it. A value-only upsert (existing key, new value) leaves the key SET
    // identical, and a remove of a non-member (a repeat/no-op drop) leaves it
    // identical too, so in either case re-publishing the whole key array would be a
    // redundant full-snapshot the `keys` subscribers fold to the same set (and a
    // spurious re-render). Value updates travel the per-key `get` stream
    // (`perKeyBus`) and the batched `deltas` stream (`coalescer`), both of which DO
    // fire on every upsert.
    //
    // "New key" must mean new to SUBSCRIBERS, NOT new to the store. A registry-
    // PROJECTION collection (kolu's `awareness` / `authored` / `daemonStatus`) has
    // a no-op `upsert` and adds the entry to its registry BEFORE calling this
    // publish, so `collDeps.readAll().has(k)` is ALREADY true here — a store test
    // taken before `upsert` would read the key as pre-existing and never broadcast
    // the add, so an already-subscribed `keys` consumer (a cross-process mirror)
    // would never see a key born after it connected (kolu's own client dodges this
    // by sourcing membership from a sibling, then reading per-key values). So track
    // the framework's OWN record of which keys it has broadcast and fire the
    // membership snapshot on a key's first upsert regardless of when the backing
    // inserted it — correct for an in-memory Map dep (where `upsert` adds the key)
    // and a registry projection alike.
    //
    // Seed the set from the keys ALREADY in the backing store at construction. A
    // consumer that subscribes later reads those keys from the `keys` handler's
    // connect snapshot (which reads `readAll()` live), so they need no membership
    // delta — and a value-only upsert on a key PRELOADED before this server was
    // built must NOT spuriously re-publish the whole key set. (An empty seed would
    // fire one redundant full-snapshot on such a key's first upsert: harmless —
    // subscribers fold it to the same set — but a real weakening of the
    // "membership-change only" contract this stream promises, and untested.) The
    // published array is always the live `readAll()` set, so the seed only ever
    // suppresses a redundant snapshot, never a wrong one.
    // Expose this collection to `$`: a sibling read returns its LIVE map
    // (`readAll()`); its change edge fires on every accepted key change below (a
    // version poke — a compute reading `$.<coll>()` re-runs, then its OWN member
    // `equals` is the final wire dedup). Registered before the wrapped publishers
    // so `siblingChange[key]` exists when they fire.
    registerSibling(key, () => collDeps.readAll());
    const broadcastKeys = new Set<unknown>(collDeps.readAll().keys());
    const wrappedUpsert = (k: unknown, v: unknown) => {
      collDeps.upsert(k, v);
      if (!broadcastKeys.has(k)) {
        broadcastKeys.add(k);
        keysBus.publish(Array.from(collDeps.readAll().keys()));
      }
      perKeyBus(k).publish(v);
      coalescer?.upsert(k, v);
      siblingChange[key]?.(); // version poke — a $-reader of this collection recomputes
    };
    const wrappedRemove = (k: unknown) => {
      collDeps.remove(k);
      if (broadcastKeys.delete(k)) {
        keysBus.publish(Array.from(collDeps.readAll().keys()));
      }
      coalescer?.remove(k);
      siblingChange[key]?.(); // version poke — a removal changes what a $-reader folds
    };

    collectionsCtx[key] = {
      upsert: wrappedUpsert,
      remove: wrappedRemove,
      readAll: collDeps.readAll,
      readOne: collDeps.readOne ?? ((k: unknown) => collDeps.readAll().get(k)),
    };

    const handlers = collectionHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.collections as any)[key] as Collection<
        string,
        unknown,
        unknown
      >,
      {
        readAll: collDeps.readAll,
        readOne: collDeps.readOne,
        upsert: wrappedUpsert,
        remove: wrappedRemove,
        perKeyBus: perKeyBus as (k: unknown) => Channel<unknown>,
        keysBus: keysBus as Channel<unknown[]>,
        deltasBus,
      },
    );

    const ns: Record<string, unknown> = {};
    for (const v of collVerbs) {
      // biome-ignore lint/suspicious/noExplicitAny: handler map indexed by verb string
      const h = (handlers as any)[v];
      if (h === undefined) continue;
      ns[v] = root[key][v].handler(h);
    }
    namespaces[key] = { ...(namespaces[key] ?? {}), ...ns };
  }

  // ── Streams ──────────────────────────────────────────────────────────
  for (const [key] of Object.entries(spec.streams ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const streamDeps = (deps.streams as any)?.[key] as
      | {
          source?: (
            i: unknown,
            s: AbortSignal | undefined,
          ) => AsyncIterable<unknown>;
          read?: (i: unknown) => Promise<unknown>;
          install?: (i: unknown, onEvent: () => void) => () => void;
          isEqual?: (a: unknown, b: unknown) => boolean;
          onReadError?: (err: unknown) => void;
        }
      | undefined;
    if (!streamDeps) {
      throw new Error(`implementSurface: missing deps for stream "${key}"`);
    }
    // Synthesize `source` from the poll shape when `source` is not supplied
    // directly. The poll shape is the common case for external mutable
    // state (git, fs); the framework owns `pollOnEvent` so consumers
    // don't repeat the snapshot+install+re-read+isEqual plumbing per stream.
    let source: (
      i: unknown,
      s: AbortSignal | undefined,
    ) => AsyncIterable<unknown>;
    if (streamDeps.source) {
      source = streamDeps.source;
    } else if (streamDeps.read && streamDeps.install && streamDeps.isEqual) {
      const read = streamDeps.read;
      const install = streamDeps.install;
      const isEqual = streamDeps.isEqual;
      // Per-stream override wins; fall back to top-level. Boot-time check
      // — a poll-shape stream with no observability for transient read
      // failures is almost always a bug, so fail at wiring rather than
      // silently swallow at runtime.
      const topLevel = deps.onStreamReadError;
      const onReadError =
        streamDeps.onReadError ??
        (topLevel ? (err: unknown) => topLevel(err, { stream: key }) : null);
      if (onReadError === null) {
        throw new Error(
          `implementSurface: stream "${key}" uses poll shape but has no onReadError — supply per-stream or set top-level onStreamReadError`,
        );
      }
      source = (input, signal) =>
        pollOnEvent({
          read: () => read(input),
          install: (cb) => install(input, cb),
          isEqual,
          signal,
          onReadError,
        });
    } else {
      throw new Error(
        `implementSurface: stream "${key}" needs either { source } or { read, install, isEqual }`,
      );
    }
    const handlers = streamHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.streams as any)[key] as Stream<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    namespaces[key] = {
      ...(namespaces[key] ?? {}),
      get: root[key].get.handler(handlers.get),
    };
  }

  // ── Events ───────────────────────────────────────────────────────────
  // The surface owns each event's per-input channel. Domain code publishes
  // via `ctx.events.<key>.publish(input, payload)`; the wire source reads
  // from the same channel. Channel name = `<key>:<keyOfInput(input)>`.
  const eventsCtx: Record<string, unknown> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const eventDeps = (deps.events as any)?.[key] as
      | {
          source?: (
            i: unknown,
            s: AbortSignal | undefined,
            helpers: { bus: Channel<unknown> },
          ) => AsyncIterable<unknown>;
        }
      | undefined;
    const busFor = (input: unknown): Channel<unknown> =>
      deps.channel<unknown>(`${key}:${eventChannelKey(input)}`);
    eventsCtx[key] = {
      publish: (input: unknown, payload: unknown) => {
        busFor(input).publish(payload);
      },
    };
    const consumerSource = eventDeps?.source;
    const source = (
      input: unknown,
      signal: AbortSignal | undefined,
    ): AsyncIterable<unknown> => {
      const bus = busFor(input);
      return consumerSource
        ? consumerSource(input, signal, { bus })
        : bus.subscribe(signal);
    };
    const handlers = eventHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: descriptor is type-discriminator only at runtime
      (surface.descriptors.events as any)[key] as Event<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    namespaces[key] = {
      ...(namespaces[key] ?? {}),
      get: root[key].get.handler(handlers.get),
    };
  }

  // ── Procedures ───────────────────────────────────────────────────────
  const ctx = {
    cells: cellsCtx,
    collections: collectionsCtx,
    events: eventsCtx,
  };
  for (const [ns, procs] of Object.entries(spec.procedures ?? {})) {
    namespaces[ns] = namespaces[ns] ?? {};
    // biome-ignore lint/suspicious/noExplicitAny: walk-by-string of the keyed deps
    const procDeps = (deps.procedures as any)?.[ns] as
      | Record<string, (opts: unknown) => unknown>
      | undefined;
    for (const verb of Object.keys(procs)) {
      const handler = procDeps?.[verb];
      if (!handler) {
        throw new Error(
          `implementSurface: missing handler for procedure "${ns}.${verb}"`,
        );
      }
      namespaces[ns][verb] = root[ns][verb].handler(
        // biome-ignore lint/suspicious/noExplicitAny: oRPC handler opts are dynamic; ctx is typed via SurfaceCtx<S>
        (opts: any) => handler({ ...opts, ctx }),
      );
    }
  }

  // Auto-answer the framework-reserved liveness probe (see @kolu/surface
  // ./liveness). It lives only in the contract (`defineSurface` injects it),
  // never in `spec`, so the procedures loop above neither demanded a dep nor
  // bound it — bind it here, merged into any app-owned `system.*` handlers, with
  // a trivial `{}` reply (resolution is the liveness signal). No app implements
  // it, so a client heartbeat / ssh watchdog gets a contract-agnostic round-trip
  // for free.
  namespaces[LIVENESS_NAMESPACE] = {
    ...(namespaces[LIVENESS_NAMESPACE] ?? {}),
    [LIVENESS_VERB]: root[LIVENESS_NAMESPACE][LIVENESS_VERB].handler(
      () => ({}),
    ),
  };

  // Auto-answer the framework-reserved identity probe (see @kolu/surface
  // ./identity), the identity twin of `system.live` in the SAME reserved `system`
  // namespace. Stamps the server's process start; a server that DECLARED a build
  // (`identity` arg — only padi does) is served `identified`, else `anonymous`. No
  // app implements it. The served value is constant for the process lifetime, so
  // compute it once. (Merged into the same `system` namespace the liveness verb
  // just wrote — the spread preserves `live`.)
  const servedIdentity = serveIdentity(SERVER_STARTED_AT, identity);
  namespaces[IDENTITY_NAMESPACE] = {
    ...(namespaces[IDENTITY_NAMESPACE] ?? {}),
    [IDENTITY_VERB]: root[IDENTITY_NAMESPACE][IDENTITY_VERB].handler(
      () => servedIdentity,
    ),
  };

  // Auto-answer the framework-reserved clock probe (see @kolu/surface ./clockNow),
  // the clock twin of `system.live`/`system.identity` in the SAME reserved `system`
  // namespace. Replies with this process's own wall clock — computed FRESH per call
  // (unlike the constant identity), since a consumer measures the far-end clock
  // OFFSET off it at admit (`Date.now()` is already the uptime source above). No app
  // implements it. (Merged into the same `system` namespace — the spread preserves
  // `live` and `identity`.)
  namespaces[CLOCK_NOW_NAMESPACE] = {
    ...(namespaces[CLOCK_NOW_NAMESPACE] ?? {}),
    [CLOCK_NOW_VERB]: root[CLOCK_NOW_NAMESPACE][CLOCK_NOW_VERB].handler(() => ({
      epochMs: Date.now(),
    })),
  };

  // ── Bind compute cells ($ read face) ───────────────────────────────────
  // Every member has validated and every cell/collection sibling source now
  // exists, so build each compute-fn `derived.cell(($) => …)` node and eager-seed
  // its private store — the last synchronous step before the walk returns, so a
  // seed's dependency graph is whole. Runs in declaration order: a compute cell
  // that reads another compute sibling reads its already-seeded value only if the
  // upstream is declared first — a diamond across compute cells that needs a
  // specific order is the caller's to declare, exactly as an app orders its
  // `computed`s. A seed throw here is a boot crash (mirror-never-fabricate); the
  // graph subscriptions it installs are walk-local closures, discarded with the
  // walk if a throw unwinds it.
  for (const bind of bindComputeCells) bind(siblingSources);

  return { namespaces, ctx: ctx as SurfaceCtx<S>, starts };
}

/** Build a directly-servable, supervised {@link SurfaceRuntime} from a surface +
 *  dep wiring. Replaces the hand-listed `t.X.<verb>.handler(handlers.<verb>)`
 *  plumbing for every cell, collection, stream, event, and imperative procedure
 *  declared in the surface.
 *
 *  Returns a {@link SurfaceRuntime}:
 *
 *    - `router` — the FINAL top-level oRPC router. Hand it straight to
 *      `RPCHandler` / `serveOverStdio` / `directLink`, or spread its
 *      `.surface` beside a consumer's own raw namespaces (kolu's server splices
 *      `server`/`daemon` this way). No consumer re-finalizes via `implement`.
 *    - `ctx` — the typed cells/collections/events helper map. Domain code
 *      mutates via `surfaceCtx.cells.X.set(value)` etc. — the surface owns the
 *      apply+publish chain, so parallel `store.set + bus.publish` paths (and
 *      their drift risk) don't exist.
 *    - `done` / `close` — the supervision contract: `done` rejects on an owned
 *      fault (a cell connector rejecting), `close` releases every owned source
 *      and is idempotent. A serving site MUST observe `done` and route it into
 *      its existing failure policy. */
/** Optional serve-time knobs for {@link implementSurface}. */
export interface ImplementSurfaceOptions {
  /** The server's DECLARED build triple — what the reserved `system.identity` serves
   *  as its `identified` arm (the framework stamps `startedAt`). Omit and the surface
   *  is served `anonymous` (connected, no build declared) — the right answer for every
   *  server whose identity no consumer reads (drishti-agent, odu-runner). Only a
   *  server with a reader (padi) declares it. */
  identity?: BakedIdentity;
}

/** Serve a single surface as a directly-servable, supervised
 *  {@link SurfaceRuntime}. Owns an internal `inMemoryChannelByName()` — the
 *  in-process channel factory every self-contained consumer was passing by hand.
 *  A consumer that must serve on a SHARED, caller-owned publisher (cross-channel
 *  microtask order load-bearing) reaches for {@link implementSurfaceOnPublisher}
 *  instead — a distinct ownership promise, never a mode flag. */
export function implementSurface<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S>,
  opts?: ImplementSurfaceOptions,
): SurfaceRuntime<S> {
  return implementSurfaceOnPublisher(
    surface,
    deps,
    inMemoryChannelByName(),
    opts,
  );
}

/** Serve a single surface on a caller-provided channel factory (a shared
 *  publisher whose lifetime the runtime does NOT own — the runtime's `close`
 *  releases only what IT minted). Distinct from {@link implementSurface}
 *  because kolu's shared `MemoryPublisher` carries non-surface channels too, so
 *  its cross-channel microtask order is load-bearing and its teardown is the
 *  caller's, not the surface's. */
export function implementSurfaceOnPublisher<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S>,
  channel: <T>(name: string) => Channel<T>,
  opts?: ImplementSurfaceOptions,
): SurfaceRuntime<S> {
  // oRPC's typed implement(contract) chain is too dynamic for our walk
  // (we walk the spec at runtime to wire each entry); cast the whole
  // builder + result to `any` and rely on the surface's spec types for
  // call-site safety.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const t = implement(surface.contract as any) as any;
  const { namespaces, ctx, starts } = walkSurface(
    t.surface,
    surface,
    { ...deps, channel },
    opts?.identity,
  );
  // The FINAL top-level router: `implement(contract).router({ ...fragment })`
  // flattens the bare `{ surface: t.router(namespaces) }` fragment (which
  // would double-prefix to `/surface/surface/…`) to `/surface/…`. No consumer
  // re-finalizes the surface via oRPC `implement` anymore.
  // biome-ignore lint/suspicious/noExplicitAny: Lazy<Router> spread isn't typed by oRPC; runtime shape is a valid router.
  const router = t.router({ surface: t.router(namespaces) }) as any;
  // Transactional construction: only NOW — after the walk validated every member
  // and the router assembled without throwing — do we start the connectors. A
  // throw above returns before any source spins up, so none can be orphaned.
  const sources = starts.map((start) => start());
  const { done, close } = superviseSurface(sources);
  return { router, ctx, done, close };
}

// ── implementSurfaces — sibling surfaces over one transport ─────────────

/** A keyed map of independent surfaces — the single source of *which*
 *  surfaces exist under *which* keys. Browser-safe (no server impls), so the
 *  same value feeds `composeSurfaceContracts` (contract), `surfaceClients`
 *  (client), and `implementSurfaces` (server). Each surface is served as a
 *  SIBLING namespaced by its key — they are NOT merged into one surface. */
// biome-ignore lint/suspicious/noExplicitAny: the map is heterogeneous; each value pins its own SurfaceSpec.
export type SurfaceMap = Record<string, Surface<any>>;

/** The per-key server-implementation deps for a `SurfaceMap` — the same
 *  per-primitive wiring `implementSurface` takes (cell stores, collection
 *  readers, stream/event sources, procedure handlers). `channel` is not a dep
 *  (the base owns it, key-namespaced). Typed against each surface's own spec,
 *  so a key's deps are checked precisely (no `any`-spec'd entry map). */
export type SurfaceDepsFor<S extends SurfaceMap> = {
  [K in keyof S]: S[K] extends Surface<infer Spec>
    ? ImplementSurfaceDeps<Spec>
    : never;
};

/** The per-key typed mutation ctx returned by `implementSurfaces`. */
export type SurfacesCtx<S extends SurfaceMap> = {
  [K in keyof S]: S[K] extends Surface<infer Spec> ? SurfaceCtx<Spec> : never;
};

/** Serve a keyed MAP of independent surfaces multiplexed over one transport,
 *  each namespaced by its key. Unlike `implementSurface`, the surfaces are NOT
 *  merged — surface-app stays a complete surface served as a sibling of the
 *  app surface under its own key.
 *
 *  Three args, mirroring the contract/client side: `surfaces` (the same
 *  browser-safe `SurfaceMap` you pass to `composeSurfaceContracts` /
 *  `surfaceClients` — the single source of keys+surfaces), `base` (the one
 *  transport's `channel` + fallback `onStreamReadError`), and `deps` (the
 *  server-only per-surface impls, keyed the same as `surfaces`). The surfaces
 *  aren't re-listed here; only their deps are.
 *
 *  Routing: a combined contract of shape `{ surface: { <key>: innerContract } }`
 *  is built from `surfaces` (via `composeSurfaceContracts`, the same receptacle
 *  the contract side uses), then each surface's handlers are bound under
 *  `t.surface[key]`. Procedures route at `/surface/<key>/<prim>/<verb>` — no
 *  double-prefix, because the inner contract is re-keyed rather than raw-nested.
 *
 *  Channels are key-namespaced: each surface's `channel(name)` call is rewritten
 *  to `base.channel(key + "/" + name)`, so two surfaces that each own e.g. a
 *  `buildInfo:changed` channel can't collide on the wire. `base.onStreamReadError`
 *  is the fallback for any surface whose deps don't supply their own. */
/** The transport-level base for {@link implementSurfaces} — everything shared
 *  across the sibling surfaces EXCEPT the channel factory (which the ordinary
 *  constructor owns internally; {@link implementSurfacesOnPublisher} injects). */
export interface ImplementSurfacesBase<S extends SurfaceMap> {
  /** Fallback subsequent-read error handler for any sibling's poll-shape streams
   *  whose deps don't supply their own. */
  onStreamReadError?: (err: unknown, info: { stream: string }) => void;
  /** Per-key DECLARED build identity — what each sibling's reserved
   *  `system.identity` serves as its `identified` arm (see `./identity`). Omit a
   *  key → that sibling serves `anonymous`. Only a sibling whose identity a
   *  consumer reads (kolu-server reads the `padi` sibling's) needs an entry. */
  identity?: { [K in keyof S]?: BakedIdentity };
}

export function implementSurfaces<const S extends SurfaceMap>(
  surfaces: S,
  base: ImplementSurfacesBase<S>,
  deps: SurfaceDepsFor<S>,
): SurfacesRuntime<S> {
  return implementSurfacesOnPublisher(
    surfaces,
    { ...base, channel: inMemoryChannelByName() },
    deps,
  );
}

/** The shared-publisher sibling of {@link implementSurfaces}: the caller injects
 *  the one transport's `channel` (a shared `MemoryPublisher` whose lifetime the
 *  runtime does NOT own). Distinct constructor, not a mode flag — the shared
 *  publisher's cross-channel microtask order is load-bearing (kolu's terminal
 *  list vs. per-terminal exit ordering) and its teardown is the caller's. */
export function implementSurfacesOnPublisher<const S extends SurfaceMap>(
  surfaces: S,
  base: ImplementSurfacesBase<S> & {
    channel: <T>(name: string) => Channel<T>;
  },
  deps: SurfaceDepsFor<S>,
): SurfacesRuntime<S> {
  // The combined contract envelope has ONE definition — the receptacle the
  // contract side already uses. We re-key rather than raw-nest the built
  // routers (a built router keeps its baked `surface.*` path, which would
  // double-prefix to /surface/<key>/surface/…).
  const combinedContract = composeSurfaceContracts(surfaces);
  // biome-ignore lint/suspicious/noExplicitAny: oRPC implement chain is too dynamic for our runtime walk.
  const t = implement(combinedContract as any) as any;

  const byKey: Record<string, Record<string, Record<string, unknown>>> = {};
  const ctxByKey: Record<string, unknown> = {};
  const starts: SurfaceSourceStart[] = [];
  for (const [key, surface] of Object.entries(surfaces)) {
    const keyedChannel = <T>(name: string): Channel<T> =>
      base.channel<T>(`${key}/${name}`);
    const surfaceDeps = (
      deps as Record<string, ImplementSurfaceDeps<SurfaceSpec>>
    )[key];
    if (!surfaceDeps) {
      throw new Error(`implementSurfaces: missing deps for surface "${key}"`);
    }
    const walked = walkSurface(
      t.surface[key],
      surface,
      {
        ...surfaceDeps,
        channel: keyedChannel,
        onStreamReadError:
          surfaceDeps.onStreamReadError ?? base.onStreamReadError,
      },
      base.identity?.[key as keyof S],
    );
    byKey[key] = walked.namespaces;
    ctxByKey[key] = walked.ctx;
    starts.push(...walked.starts);
  }

  // FINAL top-level router (see `implementSurface` — the outer `t.router`
  // flattens the `{ surface: … }` fragment to `/surface/<key>/…`).
  // biome-ignore lint/suspicious/noExplicitAny: combined Lazy<Router> spread isn't typed by oRPC; runtime shape is a valid router.
  const router = t.router({ surface: t.router(byKey) }) as any;
  // Transactional construction across the WHOLE map: every sibling has been
  // walked (an invalid one threw above) and the combined router assembled, so
  // starting the connectors now can never orphan a source spun up for an
  // earlier sibling when a later sibling fails to validate.
  const sources = starts.map((start) => start());
  const { done, close } = superviseSurface(sources);
  return {
    router,
    ctx: ctxByKey as SurfacesCtx<S>,
    done,
    close,
  };
}

/** Stringify an event input as a channel key. Primitives go through
 *  `String(...)`; objects go through `JSON.stringify(...)` so each distinct
 *  input gets a stable channel name without consumer config. */
function eventChannelKey(input: unknown): string {
  return typeof input === "object" && input !== null
    ? JSON.stringify(input)
    : String(input);
}
