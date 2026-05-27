/**
 * @kolu/surface/server — server-side bindings for the typed reactive surface.
 *
 * Headline API: `implementSurface(surface, deps)` walks a `Surface` (from
 * `defineSurface`) and produces both a router fragment and a typed
 * mutation `ctx` — every cell/collection/stream/event/procedure wired in
 * one declarative call. The framework owns the snapshot+deltas wire
 * protocol on both sides; client `useCell` / `useCollection` /
 * `useStream` consume what `implementSurface` produces, and `ctx.cells.X.set(...)`
 * etc. let domain code mutate without parallel store-and-publish paths.
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
  type CellSpec,
  type CollectionSpec,
  DEFAULT_CELL_VERBS_WITH_PATCH,
  DEFAULT_CELL_VERBS_WITHOUT_PATCH,
  DEFAULT_COLLECTION_VERBS,
  type EventSpec,
  type ProcedureSpec,
  type StreamSpec,
  type Surface,
  type SurfaceSpec,
} from "./define";
import type { Cell, Collection, Event, Stream } from "./index";

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
}

export interface CellHandlers<T, P = T> {
  /** Snapshot+deltas get handler. Plug into `t.X.get.handler(handlers.get)`. */
  get: (opts: { signal?: AbortSignal }) => AsyncGenerator<T>;
  /** Full-value set handler. Plug into `t.X.set.handler(handlers.set)`. */
  set: (opts: { input: T }) => void;
  /** Patch handler — applies `deps.patch(current, input)` and persists. */
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
}

export interface CollectionHandlers<K, T> {
  keys: (opts: { signal?: AbortSignal }) => AsyncGenerator<K[]>;
  get: (opts: { input: { key: K }; signal?: AbortSignal }) => AsyncGenerator<T>;
  upsert: (opts: { input: { key: K; value: T } }) => void;
  delete: (opts: { input: { key: K } }) => void;
  test__set: (opts: { input: Array<{ key: K; value: T }> }) => void;
}

export function collectionHandlers<Name extends string, K, T>(
  _coll: Collection<Name, K, T>,
  deps: CollectionHandlerDeps<K, T>,
): CollectionHandlers<K, T> {
  const readOne = deps.readOne ?? ((k: K) => deps.readAll().get(k));

  return {
    keys: async function* ({ signal }) {
      yield Array.from(deps.readAll().keys());
      for await (const v of deps.keysBus.subscribe(signal)) yield v;
    },
    get: async function* ({ input, signal }) {
      const initial = readOne(input.key);
      if (initial === undefined) {
        throw new Error(
          `collection ${_coll.name}: key not found at first snapshot`,
        );
      }
      yield initial;
      for await (const v of deps.perKeyBus(input.key).subscribe(signal)) {
        yield v;
      }
    },
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
 *  Subscriber backpressure: each subscriber gets its own bounded promise
 *  queue. If a subscriber falls behind, its queue grows in memory — the
 *  channel does not drop. Consumers must keep up or unsubscribe.
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

export function inMemoryChannel<T>(): InMemoryChannel<T> {
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
        if (waiter) waiter.resolve({ value, done: false });
        else queue.push(value);
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
 *  implementSurface(surface, {
 *    channel: <T>(name) => publisherChannel<T>(publisher, name),
 *    ...
 *  });
 *  ```
 *
 *  Why this exists: `implementSurface`'s `channel:` dep is called *once
 *  per publish/subscribe site* — the surface owns names like
 *  `"<key>:changed"` and `"<key>:<k>"`. The consumer must return the
 *  *same* `Channel<T>` instance for the same name, or the framework's
 *  publishes go to one channel and the subscribers register on
 *  another. A bare `inMemoryChannel<T>()` factory (`channel: (name) =>
 *  inMemoryChannel()`) silently drops every delta because each call
 *  creates a fresh channel — the registry layer is doing the
 *  load-bearing work of binding name → instance. */
export function inMemoryPublisher(): {
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
        c = inMemoryChannel<unknown>();
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

/** Convenience: one-liner factory for the canonical `channel:` dep
 *  shape `implementSurface` expects, backed by a private
 *  `inMemoryPublisher`. Hides the two-step
 *  `const publisher = inMemoryPublisher(); channel: (name) =>
 *  publisherChannel(publisher, name)` cassette that every in-process
 *  consumer was repeating verbatim. Same semantics: one channel
 *  instance per name, shared by every call.
 *
 *  ```ts
 *  implementSurface(surface, {
 *    channel: inMemoryChannelByName(),
 *    cells: { ... },
 *  });
 *  ```
 *
 *  Use `inMemoryPublisher` + `publisherChannel` directly when you
 *  need the publisher reference for something else (cross-cell
 *  publishes, instrumentation, etc.); reach for this helper for the
 *  90% case where you just want named in-process channels. */
export function inMemoryChannelByName(): <T>(name: string) => Channel<T> {
  const publisher = inMemoryPublisher();
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
 *  in-process observers AND back a framework-managed surface cell. */
export function inMemoryCell<T>(initial: T): Channel<T> & {
  current(): T;
  set(value: T): void;
} {
  let value = initial;
  const deltas = inMemoryChannel<T>();
  return {
    current: () => value,
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

/** Iterate `source` and yield each item, ending cleanly if the iterator
 *  rejects with the signal's abort reason. Adds one microtask of delay
 *  per yield (see `publisherChannel`'s comment for why that matters). */
async function* iterateUntilAborted<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  try {
    for await (const item of source) yield item;
  } catch (err) {
    if (signal?.aborted && err === signal.reason) return;
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
    }
  : S extends { schema: ZodType<infer T> }
    ? {
        store: CellStore<T>;
        equals?: (a: T, b: T) => boolean;
        onMutate?: (next: T, current: T) => void;
        onWrite?: (next: T) => void;
      }
    : never;

/** Per-collection implementation deps. The surface owns both buses
 *  (`<key>:keys` and `<key>:<k>`, derived from the surface key — not
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
type CellCtxFor<S> = S extends {
  schema: ZodType<infer T>;
  patchSchema: ZodType<infer P>;
}
  ? { get: () => T; set: (v: T) => void; patch: (p: P) => void }
  : S extends { schema: ZodType<infer T> }
    ? { get: () => T; set: (v: T) => void }
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

export interface ImplementSurfaceDeps<S extends SurfaceSpec> {
  /** Channel factory. The framework computes channel names from surface
   *  keys (e.g. `"prefs:changed"`, `"notes:keys"`, `"notes:n1"`) and
   *  passes them into this fn — the consumer plugs in their underlying
   *  publisher (`publisherChannel(publisher, name)` for the `@orpc/experimental-publisher`
   *  adapter). */
  channel: <T>(name: string) => Channel<T>;

  /** Default subsequent-read error handler for poll-shape streams (those
   *  declared with `{ read, install, isEqual }` rather than a raw `source`).
   *  Per-stream `onReadError` overrides this. The initial read's error
   *  always propagates regardless. Required when at least one poll-shape
   *  stream omits its own `onReadError`; pass `() => {}` to opt into
   *  silent-skip explicitly. */
  onStreamReadError?: (err: unknown, info: { stream: string }) => void;

  cells?: {
    [K in keyof S["cells"] & string]: CellImplDeps<NonNullable<S["cells"]>[K]>;
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

/** Build the full server router from a surface + dep wiring. Replaces the
 *  hand-listed `t.X.<verb>.handler(handlers.<verb>)` plumbing for every
 *  cell, collection, stream, event, and imperative procedure declared in
 *  the surface.
 *
 *  Channel naming is surface-driven and not configurable: cells use
 *  `"<key>:changed"`, collections use `"<key>:keys"` + `"<key>:" +
 *  String(k)`, events use `"<key>:" + eventChannelKey(input)`. Renaming a
 *  surface key thus renames the channel — for cells whose channels back
 *  persisted subscriptions, prefer adding a new key and migrating off the
 *  old one.
 *
 *  Returns `{ router, ctx }`. Spread `router` into a host `t.router({...})`
 *  alongside hand-written raw-oRPC blocks for procedures the surface can't
 *  model (custom `onRetry`, binary framing, subscribe-before-yield); use
 *  `ctx` from domain code for typed mutations:
 *
 *      const { router: surfaceRouter, ctx: surfaceCtx } =
 *        implementSurface(surface, deps);
 *      const t = implement(fullContract);
 *      export const appRouter = t.router({
 *        ...surfaceRouter,
 *        terminal: t.terminal.handler(...),
 *      });
 */
export function implementSurface<const S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: ImplementSurfaceDeps<S>,
) {
  // oRPC's typed implement(contract) chain is too dynamic for our walk
  // (we walk the spec at runtime to wire each entry); cast the whole
  // builder + result to `any` and rely on the surface's spec types for
  // call-site safety.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const t = implement(surface.contract as any) as any;
  const spec = surface.spec;

  const cellsCtx: Record<string, unknown> = {};
  const collectionsCtx: Record<string, unknown> = {};
  const namespaces: Record<string, Record<string, unknown>> = {};

  // ── Cells ────────────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.cells ?? {})) {
    const cellSpec = rawSpec as CellSpec<unknown, unknown>;
    const bus = deps.channel<unknown>(`${key}:changed`);
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    const cellDeps = (deps.cells as any)?.[key] as
      | {
          store: CellStore<unknown>;
          patch?: (c: unknown, p: unknown) => unknown;
          equals?: (a: unknown, b: unknown) => boolean;
          onMutate?: (p: unknown, c: unknown) => void;
          onWrite?: (next: unknown) => void;
        }
      | undefined;
    if (!cellDeps) {
      throw new Error(`implementSurface: missing deps for cell "${key}"`);
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
    const handlers = cellHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.cells as any)[key] as Cell<string, unknown>,
      {
        store: cellDeps.store,
        bus,
        patch: patchFn,
        equals: equalsFn,
        onMutate: cellDeps.onMutate,
        onWrite: onWriteFn,
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
    // only one side.
    const store = cellDeps.store;
    function ctxApply(next: unknown): void {
      if (equalsFn?.(store.get(), next)) return;
      onWriteFn?.(next);
      store.set(next);
      bus.publish(next);
    }
    cellsCtx[key] = {
      get: () => store.get(),
      set: ctxApply,
      ...(patchFn
        ? {
            patch: (p: unknown) => {
              ctxApply(patchFn(store.get(), p));
            },
          }
        : {}),
    };

    const verbs =
      cellSpec.verbs ??
      (cellSpec.patchSchema
        ? DEFAULT_CELL_VERBS_WITH_PATCH
        : DEFAULT_CELL_VERBS_WITHOUT_PATCH);
    const ns: Record<string, unknown> = {};
    for (const v of verbs) {
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      const h = (handlers as any)[v];
      if (h === undefined) continue;
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      ns[v] = (t as any).surface[key][v].handler(h);
    }
    namespaces[key] = { ...(namespaces[key] ?? {}), ...ns };
  }

  // ── Collections ──────────────────────────────────────────────────────
  for (const [key, rawSpec] of Object.entries(spec.collections ?? {})) {
    const collSpec = rawSpec as CollectionSpec<unknown, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
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
    const keysBus = deps.channel<unknown[]>(`${key}:keys`);
    const perKeyBus = (k: unknown) =>
      deps.channel<unknown>(`${key}:${String(k)}`);

    // Surface-owned publish: every upsert/remove broadcasts the new key set
    // (and, on upsert, the new per-key value) through the framework's
    // channels. Consumers' upsert/remove stay persistence-only.
    const wrappedUpsert = (k: unknown, v: unknown) => {
      collDeps.upsert(k, v);
      keysBus.publish(Array.from(collDeps.readAll().keys()));
      perKeyBus(k).publish(v);
    };
    const wrappedRemove = (k: unknown) => {
      collDeps.remove(k);
      keysBus.publish(Array.from(collDeps.readAll().keys()));
    };

    collectionsCtx[key] = {
      upsert: wrappedUpsert,
      remove: wrappedRemove,
      readAll: collDeps.readAll,
      readOne: collDeps.readOne ?? ((k: unknown) => collDeps.readAll().get(k)),
    };

    const handlers = collectionHandlers(
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
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
      },
    );

    const verbs = collSpec.verbs ?? DEFAULT_COLLECTION_VERBS;
    const ns: Record<string, unknown> = {};
    for (const v of verbs) {
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      const h = (handlers as any)[v];
      if (h === undefined) continue;
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      ns[v] = (t as any).surface[key][v].handler(h);
    }
    namespaces[key] = { ...(namespaces[key] ?? {}), ...ns };
  }

  // ── Streams ──────────────────────────────────────────────────────────
  for (const [key] of Object.entries(spec.streams ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
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
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.streams as any)[key] as Stream<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    namespaces[key] = {
      ...(namespaces[key] ?? {}),
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      get: (t as any).surface[key].get.handler(handlers.get),
    };
  }

  // ── Events ───────────────────────────────────────────────────────────
  // The surface owns each event's per-input channel. Domain code publishes
  // via `ctx.events.<key>.publish(input, payload)`; the wire source reads
  // from the same channel. Channel name = `<key>:<keyOfInput(input)>`.
  const eventsCtx: Record<string, unknown> = {};
  for (const [key] of Object.entries(spec.events ?? {})) {
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
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
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      (surface.descriptors.events as any)[key] as Event<
        string,
        unknown,
        unknown
      >,
      { source },
    );
    namespaces[key] = {
      ...(namespaces[key] ?? {}),
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      get: (t as any).surface[key].get.handler(handlers.get),
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
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
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
      // biome-ignore lint/suspicious/noExplicitAny: see top of fn
      namespaces[ns][verb] = (t as any).surface[ns][verb].handler(
        // biome-ignore lint/suspicious/noExplicitAny: see top of fn
        (opts: any) => handler({ ...opts, ctx }),
      );
    }
  }

  // Returns `{ router, ctx }`:
  //
  //   - `router` — a fragment under the top-level `surface` key, ready to
  //     spread into the consumer's host `t.router({...})` alongside
  //     hand-listed raw namespaces:
  //
  //       const { router: surfaceRouter, ctx: surfaceCtx } =
  //         implementSurface(surface, deps);
  //       const appRouter = t.router({
  //         ...surfaceRouter,
  //         terminal: { create: t.terminal.create.handler(...) },
  //       });
  //
  //   - `ctx` — the typed cells/collections/events helper map. Domain
  //     code that mutates a cell or collection (or fires an event) imports
  //     `surfaceCtx` and calls `surfaceCtx.cells.X.set(value)` etc. — the
  //     surface owns the apply+publish chain so direct `store.set + bus.publish`
  //     parallel paths (and their drift risk) don't exist.
  return {
    // biome-ignore lint/suspicious/noExplicitAny: see top of fn
    router: { surface: t.router(namespaces) } as any,
    ctx: ctx as SurfaceCtx<S>,
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
